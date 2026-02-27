const express = require('express');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBucket = process.env.SUPABASE_BUCKET || 'art-submissions';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  // eslint-disable-next-line no-console
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

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

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/submissions', async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('submissions')
      .select('id, artist_name, art_title, artist_email, original_filename, file_url, file_type, submitted_at')
      .order('submitted_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(error.message);
    }

    const submissions = (data || []).map((row) => ({
      id: row.id,
      artistName: row.artist_name,
      artTitle: row.art_title,
      artistEmail: row.artist_email,
      originalFilename: row.original_filename,
      fileUrl: row.file_url,
      fileType: row.file_type,
      submittedAt: row.submitted_at,
    }));

    res.json({ submissions });
  } catch (error) {
    next(error);
  }
});

app.post('/api/submissions', upload.single('artFile'), async (req, res, next) => {
  try {
    const artistName = String(req.body.artistName || '').trim();
    const artTitle = String(req.body.artTitle || '').trim();
    const artistEmail = String(req.body.artistEmail || '').trim();

    if (!artistName || !artTitle || !artistEmail || !req.file) {
      return res.status(400).json({
        error: 'artistName, artTitle, artistEmail, and artFile are required.',
      });
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
      art_title: artTitle,
      artist_email: artistEmail,
      original_filename: req.file.originalname,
      file_url: publicUrlData.publicUrl,
      file_type: req.file.mimetype,
    };

    const { data: inserted, error: insertError } = await supabase
      .from('submissions')
      .insert(record)
      .select('id, artist_name, art_title, artist_email, original_filename, file_url, file_type, submitted_at')
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    const submission = {
      id: inserted.id,
      artistName: inserted.artist_name,
      artTitle: inserted.art_title,
      artistEmail: inserted.artist_email,
      originalFilename: inserted.original_filename,
      fileUrl: inserted.file_url,
      fileType: inserted.file_type,
      submittedAt: inserted.submitted_at,
    };

    res.status(201).json({
      message: 'Submission received successfully.',
      submission,
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
