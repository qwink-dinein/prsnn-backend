
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';
import dotenv from 'dotenv';

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
    allowed_formats: ['jpg', 'png', 'jpeg'],
  },
});

export const upload = multer({ storage: storage });
