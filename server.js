const express = require('express');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBucket = process.env.SUPABASE_BUCKET || 'art-submissions';
const adminToken = process.env.ADMIN_TOKEN || '';
const rateLimitWindowMs = Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '600000', 10);
const rateLimitMax = Number.parseInt(process.env.RATE_LIMIT_MAX || '8', 10);
const smtpHost = process.env.SMTP_HOST || '';
const smtpPort = Number.parseInt(process.env.SMTP_PORT || '587', 10);
const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const smtpUser = process.env.SMTP_USER || '';
const smtpPass = process.env.SMTP_PASS || '';
const contactTo = process.env.CONTACT_TO || 'asianbartists@gmail.com';
const contactFrom = process.env.CONTACT_FROM || smtpUser || 'no-reply@asianbloomingartists.org';
const qrRedirectTarget = process.env.QR_REDIRECT_TARGET || '';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  // eslint-disable-next-line no-console
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
const submissionHitsByIp = new Map();
const contactHitsByIp = new Map();
const mailTransporter = smtpHost && smtpUser && smtpPass
  ? nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  })
  : null;

const allowedMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedMime.has(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, and PDF files are allowed.'));
    }
    cb(null, true);
  },
});

function buildStoragePath(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const base = path.basename(file.originalname || 'submission', ext)
    .replace(/[^a-z0-9_-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .toLowerCase();
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `submissions/${base || 'submission'}-${stamp}${ext}`;
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return String(req.ip || 'unknown').trim();
}

function checkSubmissionRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const earliestAllowed = now - rateLimitWindowMs;
  const recentHits = (submissionHitsByIp.get(ip) || []).filter((ts) => ts > earliestAllowed);

  if (recentHits.length >= rateLimitMax) {
    return res.status(429).json({
      error: 'Too many submissions right now. Please wait a few minutes before trying again.',
    });
  }

  recentHits.push(now);
  submissionHitsByIp.set(ip, recentHits);
  next();
}

function checkContactRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const earliestAllowed = now - rateLimitWindowMs;
  const recentHits = (contactHitsByIp.get(ip) || []).filter((ts) => ts > earliestAllowed);

  if (recentHits.length >= rateLimitMax) {
    return res.status(429).json({
      error: 'Too many contact messages right now. Please wait a few minutes before trying again.',
    });
  }

  recentHits.push(now);
  contactHitsByIp.set(ip, recentHits);
  next();
}

function requireAdmin(req, res, next) {
  if (!adminToken) {
    return res.status(503).json({ error: 'ADMIN_TOKEN is not configured on the server.' });
  }

  const provided = String(req.get('x-admin-token') || req.query.token || '').trim();
  if (!provided || provided !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized admin access.' });
  }

  next();
}

function toPublicSubmission(row) {
  return {
    id: row.id,
    referenceNumber: `ABA-${String(row.id).padStart(4, '0')}`,
    artistName: row.artist_name,
    artistAge: row.artist_age ?? null,
    artistSchool: row.artist_school || null,
    artTitle: row.art_title,
    artDimensions: row.art_dimensions || null,
    is3D: row.is_3d === true,
    artDescription: row.art_description || null,
    originalFilename: row.original_filename,
    fileUrl: row.file_url,
    fileType: row.file_type,
    submittedAt: row.submitted_at,
    finalistTier: row.finalistTier || null,
    voteCount: Number(row.voteCount || 0),
  };
}

function toAdminSubmission(row) {
  return {
    id: row.id,
    referenceNumber: `ABA-${String(row.id).padStart(4, '0')}`,
    artistName: row.artist_name,
    artistAge: row.artist_age ?? null,
    artistSchool: row.artist_school || null,
    artTitle: row.art_title,
    artDimensions: row.art_dimensions || null,
    is3D: row.is_3d === true,
    artDescription: row.art_description || null,
    artistEmail: row.artist_email,
    originalFilename: row.original_filename,
    fileUrl: row.file_url,
    fileType: row.file_type,
    submittedAt: row.submitted_at,
    finalistTier: row.finalistTier || null,
    voteCount: Number(row.voteCount || 0),
  };
}

function escapeCsv(value) {
  const raw = String(value ?? '');
  return `"${raw.replace(/"/g, '""')}"`;
}

function parseDimensionNumbers(input) {
  const matches = String(input || '').match(/\d+(\.\d+)?/g) || [];
  return matches.map((part) => Number.parseFloat(part)).filter((value) => Number.isFinite(value));
}

function extractStoragePathFromPublicUrl(fileUrl, bucketName) {
  if (!fileUrl || !bucketName) return null;

  try {
    const parsed = new URL(String(fileUrl));
    const pathname = decodeURIComponent(parsed.pathname || '');
    const marker = `/object/public/${bucketName}/`;
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    const rawPath = pathname.slice(markerIndex + marker.length).trim();
    return rawPath || null;
  } catch {
    return null;
  }
}

async function fetchFinalistMap() {
  const { data, error } = await supabase
    .from('finalists')
    .select('submission_id, tier, tagged_at');

  if (error) throw new Error(error.message);

  const map = new Map();
  (data || []).forEach((row) => {
    map.set(Number(row.submission_id), {
      tier: String(row.tier || 'Finalist'),
      taggedAt: row.tagged_at,
    });
  });
  return map;
}

async function fetchVoteCountMap() {
  const { data, error } = await supabase
    .from('votes')
    .select('submission_id');

  if (error) throw new Error(error.message);

  const map = new Map();
  (data || []).forEach((row) => {
    const submissionId = Number(row.submission_id);
    map.set(submissionId, (map.get(submissionId) || 0) + 1);
  });
  return map;
}

function sortAdminRows(rows, sortBy, sortDir) {
  const direction = sortDir === 'asc' ? 1 : -1;
  const safeSortBy = ['votes', 'submitted', 'title', 'artist'].includes(sortBy) ? sortBy : 'submitted';

  rows.sort((a, b) => {
    if (safeSortBy === 'votes') {
      return (Number(a.voteCount || 0) - Number(b.voteCount || 0)) * direction;
    }
    if (safeSortBy === 'title') {
      return String(a.art_title || '').localeCompare(String(b.art_title || '')) * direction;
    }
    if (safeSortBy === 'artist') {
      return String(a.artist_name || '').localeCompare(String(b.artist_name || '')) * direction;
    }
    return (new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()) * direction;
  });
}

app.use(express.json());

function handleQrRedirect(_req, res) {
  if (!qrRedirectTarget) {
    return res.status(503).send('QR redirect is not configured yet.');
  }

  const safeTarget = String(qrRedirectTarget).trim();
  if (!/^https?:\/\//i.test(safeTarget)) {
    return res.status(500).send('QR_REDIRECT_TARGET must be a full http(s) URL.');
  }

  return res.redirect(302, safeTarget);
}

app.get('/redirect', handleQrRedirect);
app.get('/qr', handleQrRedirect);

app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/votes', checkContactRateLimit, async (req, res, next) => {
  try {
    const voterEmail = String(req.body.email || '').trim().toLowerCase();
    const rawReference = String(req.body.referenceNumber || '').trim().toUpperCase();

    if (!voterEmail || !rawReference) {
      return res.status(400).json({ error: 'email and referenceNumber are required.' });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(voterEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email.' });
    }

    let submissionId = Number.parseInt(rawReference, 10);
    if (Number.isNaN(submissionId)) {
      const refMatch = rawReference.match(/^ABA-(\d{1,10})$/);
      if (!refMatch) {
        return res.status(400).json({ error: 'Reference number must look like ABA-0001.' });
      }
      submissionId = Number.parseInt(refMatch[1], 10);
    }

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'Invalid reference number.' });
    }

    const { data: finalistRow, error: finalistError } = await supabase
      .from('finalists')
      .select('submission_id')
      .eq('submission_id', submissionId)
      .maybeSingle();

    if (finalistError) throw new Error(finalistError.message);
    if (!finalistRow) {
      return res.status(404).json({ error: 'That reference number is not an active finalist.' });
    }

    const { error: voteError } = await supabase.from('votes').insert({
      voter_email: voterEmail,
      submission_id: submissionId,
      voted_at: new Date().toISOString(),
    });

    if (voteError) {
      if (voteError.code === '23505') {
        return res.status(409).json({ error: 'This email has already voted.' });
      }
      throw new Error(voteError.message);
    }

    return res.status(201).json({ message: 'Vote submitted successfully.' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/contact', checkContactRateLimit, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim();
    const subject = String(req.body.subject || '').trim();
    const message = String(req.body.message || '').trim();

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: 'name, email, subject, and message are required.' });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email.' });
    }

    if (!mailTransporter) {
      return res.status(503).json({ error: 'Contact email is not configured on the server.' });
    }

    await mailTransporter.sendMail({
      from: contactFrom,
      to: contactTo,
      replyTo: email,
      subject: `ABA Contact: ${subject}`,
      text: `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\nMessage:\n${message}`,
      html: `
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br />')}</p>
      `,
    });

    return res.status(201).json({ message: 'Message sent successfully.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/submissions', async (_req, res, next) => {
  try {
    const [submissionsRes, finalistMap] = await Promise.all([
      supabase
        .from('submissions')
        .select('id, artist_name, artist_age, artist_school, art_title, art_dimensions, is_3d, art_description, original_filename, file_url, file_type, submitted_at')
        .order('submitted_at', { ascending: false })
        .limit(50),
      fetchFinalistMap(),
    ]);

    if (submissionsRes.error) {
      throw new Error(submissionsRes.error.message);
    }

    const merged = (submissionsRes.data || []).map((row) => ({
      ...row,
      finalistTier: finalistMap.get(Number(row.id))?.tier || null,
    }));

    res.json({ submissions: merged.map(toPublicSubmission) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/finalists', async (_req, res, next) => {
  try {
    const { data: finalistRows, error: finalistsError } = await supabase
      .from('finalists')
      .select('submission_id, tier, tagged_at')
      .order('tagged_at', { ascending: false })
      .limit(100);

    if (finalistsError) throw new Error(finalistsError.message);

    const ids = (finalistRows || []).map((row) => Number(row.submission_id));
    if (ids.length === 0) {
      return res.json({ submissions: [] });
    }

    const { data: submissionRows, error: submissionsError } = await supabase
      .from('submissions')
      .select('id, artist_name, artist_age, artist_school, art_title, art_dimensions, is_3d, art_description, original_filename, file_url, file_type, submitted_at')
      .in('id', ids);

    if (submissionsError) throw new Error(submissionsError.message);

    const byId = new Map((submissionRows || []).map((row) => [Number(row.id), row]));
    const merged = (finalistRows || [])
      .map((row) => {
        const submission = byId.get(Number(row.submission_id));
        if (!submission) return null;
        return {
          ...submission,
          finalistTier: String(row.tier || 'Finalist'),
          taggedAt: row.tagged_at,
        };
      })
      .filter(Boolean);

    res.json({ submissions: merged.map(toPublicSubmission) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/submissions', requireAdmin, async (_req, res, next) => {
  try {
    const sortBy = String(_req.query.sortBy || 'submitted');
    const sortDir = String(_req.query.sortDir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const [submissionsRes, finalistMap, voteCountMap] = await Promise.all([
      supabase
        .from('submissions')
        .select('id, artist_name, artist_age, artist_school, art_title, art_dimensions, is_3d, art_description, artist_email, original_filename, file_url, file_type, submitted_at')
        .order('submitted_at', { ascending: false })
        .limit(1000),
      fetchFinalistMap(),
      fetchVoteCountMap(),
    ]);

    if (submissionsRes.error) throw new Error(submissionsRes.error.message);

    const merged = (submissionsRes.data || []).map((row) => ({
      ...row,
      finalistTier: finalistMap.get(Number(row.id))?.tier || null,
      voteCount: voteCountMap.get(Number(row.id)) || 0,
    }));
    sortAdminRows(merged, sortBy, sortDir);

    res.json({ submissions: merged.map(toAdminSubmission) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/submissions.csv', requireAdmin, async (_req, res, next) => {
  try {
    const [submissionsRes, finalistMap, voteCountMap] = await Promise.all([
      supabase
        .from('submissions')
        .select('id, artist_name, artist_age, artist_school, art_title, art_dimensions, is_3d, art_description, artist_email, original_filename, file_url, file_type, submitted_at')
        .order('submitted_at', { ascending: false })
        .limit(10000),
      fetchFinalistMap(),
      fetchVoteCountMap(),
    ]);

    if (submissionsRes.error) throw new Error(submissionsRes.error.message);

    const header = [
      'id',
      'artist_name',
      'artist_age',
      'artist_school',
      'art_title',
      'art_dimensions',
      'is_3d',
      'art_description',
      'artist_email',
      'original_filename',
      'file_url',
      'file_type',
      'finalist_tier',
      'vote_count',
      'submitted_at',
    ];

    const rows = (submissionsRes.data || []).map((row) => [
      row.id,
      row.artist_name,
      row.artist_age ?? '',
      row.artist_school || '',
      row.art_title,
      row.art_dimensions || '',
      row.is_3d === true ? 'true' : 'false',
      row.art_description || '',
      row.artist_email,
      row.original_filename,
      row.file_url,
      row.file_type,
      finalistMap.get(Number(row.id))?.tier || '',
      voteCountMap.get(Number(row.id)) || 0,
      row.submitted_at,
    ]);

    const csv = [
      header.map(escapeCsv).join(','),
      ...rows.map((row) => row.map(escapeCsv).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="submissions.csv"');
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/submissions/:submissionId', requireAdmin, async (req, res, next) => {
  try {
    const submissionId = Number.parseInt(String(req.params.submissionId || ''), 10);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'A valid submissionId is required.' });
    }

    const { data: existing, error: existingError } = await supabase
      .from('submissions')
      .select('id, file_url')
      .eq('id', submissionId)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (!existing) {
      return res.status(404).json({ error: 'Submission not found.' });
    }

    const { error: votesError } = await supabase
      .from('votes')
      .delete()
      .eq('submission_id', submissionId);
    if (votesError) throw new Error(votesError.message);

    const { error: finalistsError } = await supabase
      .from('finalists')
      .delete()
      .eq('submission_id', submissionId);
    if (finalistsError) throw new Error(finalistsError.message);

    const { error: submissionError } = await supabase
      .from('submissions')
      .delete()
      .eq('id', submissionId);
    if (submissionError) throw new Error(submissionError.message);

    const storagePath = extractStoragePathFromPublicUrl(existing.file_url, supabaseBucket);
    if (storagePath) {
      // Best effort cleanup; this should not block deletion success.
      await supabase.storage.from(supabaseBucket).remove([storagePath]);
    }

    return res.status(200).json({ message: 'Submission deleted.' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/finalists', requireAdmin, async (req, res, next) => {
  try {
    const submissionId = Number.parseInt(String(req.body.submissionId || ''), 10);
    const tier = String(req.body.tier || 'Finalist').trim() || 'Finalist';

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'A valid submissionId is required.' });
    }

    const { error } = await supabase
      .from('finalists')
      .upsert(
        {
          submission_id: submissionId,
          tier,
          tagged_at: new Date().toISOString(),
        },
        { onConflict: 'submission_id' }
      );

    if (error) throw new Error(error.message);

    return res.status(200).json({ message: 'Finalist tag updated.' });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/finalists/:submissionId', requireAdmin, async (req, res, next) => {
  try {
    const submissionId = Number.parseInt(String(req.params.submissionId || ''), 10);

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'A valid submissionId is required.' });
    }

    const { error } = await supabase.from('finalists').delete().eq('submission_id', submissionId);
    if (error) throw new Error(error.message);

    return res.status(200).json({ message: 'Finalist tag removed.' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/submissions', checkSubmissionRateLimit, upload.single('artFile'), async (req, res, next) => {
  try {
    const honeypotValue = String(req.body.website || '').trim();
    if (honeypotValue) {
      return res.status(202).json({ message: 'Submission received successfully.' });
    }

    const artistName = String(req.body.artistName || '').trim();
    const artistAge = Number.parseInt(String(req.body.artistAge || ''), 10);
    const artistSchool = String(req.body.artistSchool || '').trim();
    const artTitle = String(req.body.artTitle || '').trim();
    const artLength = Number.parseFloat(String(req.body.artLength || ''));
    const artWidth = Number.parseFloat(String(req.body.artWidth || ''));
    const artHeight = Number.parseFloat(String(req.body.artHeight || ''));
    const legacyArtDimensions = String(req.body.artDimensions || '').trim();
    const is3D = ['true', '1', 'on', 'yes'].includes(String(req.body.is3D || '').toLowerCase());
    const artDescription = String(req.body.artDescription || '').trim();
    const artistEmail = String(req.body.artistEmail || '').trim();

    if (!artistName || !artistSchool || !Number.isInteger(artistAge) || !artTitle || !artDescription || !artistEmail || !req.file) {
      return res.status(400).json({
        error: 'artistName, artistAge, artistSchool, artTitle, artDescription, artistEmail, and artFile are required.',
      });
    }
    if (artistAge < 15 || artistAge > 19) {
      return res.status(400).json({ error: 'artistAge must be between 15 and 19.' });
    }

    let normalizedDimensions = '';
    if (Number.isFinite(artLength) && Number.isFinite(artWidth) && artLength > 0 && artWidth > 0) {
      if (is3D) {
        if (!Number.isFinite(artHeight) || artHeight <= 0) {
          return res.status(400).json({ error: 'For 3D artwork, height is required and must be greater than 0.' });
        }
        normalizedDimensions = `${artLength} x ${artWidth} x ${artHeight} in`;
      } else {
        if (artLength > 40 || artWidth > 40) {
          return res.status(400).json({ error: 'For 2D artwork, maximum size is 40 x 40 inches.' });
        }
        normalizedDimensions = `${artLength} x ${artWidth} in`;
      }
    } else if (legacyArtDimensions) {
      // Backward compatibility for older clients still sending a free-text dimensions field.
      const dimensions = parseDimensionNumbers(legacyArtDimensions);
      if (!is3D) {
        if (dimensions.length < 2) {
          return res.status(400).json({ error: 'For 2D artwork, provide at least L x W dimensions in inches.' });
        }
        if (dimensions[0] > 40 || dimensions[1] > 40) {
          return res.status(400).json({ error: 'For 2D artwork, maximum size is 40 x 40 inches.' });
        }
      } else if (dimensions.length < 3) {
        return res.status(400).json({ error: 'For 3D artwork, provide L x W x H dimensions in inches.' });
      }
      normalizedDimensions = legacyArtDimensions;
    } else {
      return res.status(400).json({ error: 'Please provide valid dimensions.' });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(artistEmail)) {
      return res.status(400).json({ error: 'Please provide a valid email.' });
    }

    const storagePath = buildStoragePath(req.file);

    const { error: uploadError } = await supabase.storage
      .from(supabaseBucket)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data: publicUrlData } = supabase.storage
      .from(supabaseBucket)
      .getPublicUrl(storagePath);

    const record = {
      artist_name: artistName,
      artist_age: artistAge,
      artist_school: artistSchool,
      art_title: artTitle,
      art_dimensions: normalizedDimensions,
      is_3d: is3D,
      art_description: artDescription,
      artist_email: artistEmail,
      original_filename: req.file.originalname,
      file_url: publicUrlData.publicUrl,
      file_type: req.file.mimetype,
    };

    const { data: inserted, error: insertError } = await supabase
      .from('submissions')
      .insert(record)
      .select('id, artist_name, artist_age, artist_school, art_title, art_dimensions, is_3d, art_description, artist_email, original_filename, file_url, file_type, submitted_at')
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    res.status(201).json({
      message: 'Submission received successfully.',
      submission: toAdminSubmission(inserted),
    });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File must be 10MB or less.' });
    }
    return res.status(400).json({ error: err.message });
  }

  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }

  return res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Submission backend running on http://localhost:${port}`);
});
