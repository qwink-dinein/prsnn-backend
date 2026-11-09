
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Per-environment folder so testing uploads never mix with production ones
// in the same Cloudinary cloud. Production keeps the original default.
const uploadFolder = process.env.CLOUDINARY_FOLDER || 'prsnn-verification';

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: uploadFolder,
    allowed_formats: ['jpg', 'png', 'jpeg', 'heic', 'heif', 'webp'],
  },
});

/**
 * Without Cloudinary keys outside production (local development and tests),
 * files go to ./uploads, served at /uploads. Production always needs
 * Cloudinary: the Render disk is wiped on every deploy.
 */
const useLocalDisk = process.env.NODE_ENV !== 'production' && !process.env.CLOUDINARY_API_KEY;
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync('uploads', { recursive: true });
    cb(null, 'uploads');
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '').toLowerCase() || '.jpg'}`),
});
// Disk files have no .path URL like Cloudinary's; give them one the app can load.
const withUrls = (mw) => (req, res, next) =>
  mw(req, res, (err) => {
    if (!err && useLocalDisk && req.files) {
      const base = `${req.protocol}://${req.get('host')}`;
      for (const list of Object.values(req.files)) for (const f of list) f.path = `${base}/uploads/${f.filename}`;
    }
    if (!err && useLocalDisk && req.file) req.file.path = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    next(err);
  });

// Images only, at most 8 MB each.
const base = multer({
  storage: useLocalDisk ? diskStorage : storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|jpg|heic|heif|webp)$/i.test(file.mimetype || '')),
});
export const upload = {
  single: (name) => withUrls(base.single(name)),
  fields: (spec) => withUrls(base.fields(spec)),
};
