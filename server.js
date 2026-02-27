const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const submissionsPath = path.join(dataDir, 'submissions.json');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(submissionsPath)) {
  fs.writeFileSync(submissionsPath, '[]', 'utf8');
}

function readSubmissions() {
  try {
    const raw = fs.readFileSync(submissionsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSubmissions(submissions) {
  fs.writeFileSync(submissionsPath, JSON.stringify(submissions, null, 2), 'utf8');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeBase = path.basename(file.originalname || 'submission', ext)
      .replace(/[^a-z0-9_-]/gi, '-')
      .replace(/-+/g, '-')
      .slice(0, 60)
      .toLowerCase();
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${safeBase || 'submission'}-${stamp}${ext}`);
  },
});

const allowedMime = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const upload = multer({
  storage,
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

app.use(express.json());
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/submissions', (_req, res) => {
  const submissions = readSubmissions();
  const recent = submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json({ submissions: recent.slice(0, 50) });
});

app.post('/api/submissions', upload.single('artFile'), (req, res) => {
  const artistName = String(req.body.artistName || '').trim();
  const artTitle = String(req.body.artTitle || '').trim();
  const artistEmail = String(req.body.artistEmail || '').trim();

  if (!artistName || !artTitle || !artistEmail || !req.file) {
    if (req.file?.path) {
      fs.rmSync(req.file.path, { force: true });
    }
    return res.status(400).json({
      error: 'artistName, artTitle, artistEmail, and artFile are required.',
    });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(artistEmail)) {
    if (req.file?.path) {
      fs.rmSync(req.file.path, { force: true });
    }
    return res.status(400).json({ error: 'Please provide a valid email.' });
  }

  const submissions = readSubmissions();
  const submission = {
    id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    artistName,
    artTitle,
    artistEmail,
    originalFilename: req.file.originalname,
    fileUrl: `/uploads/${req.file.filename}`,
    fileType: req.file.mimetype,
    submittedAt: new Date().toISOString(),
  };

  submissions.push(submission);
  saveSubmissions(submissions);

  res.status(201).json({
    message: 'Submission received successfully.',
    submission,
  });
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
