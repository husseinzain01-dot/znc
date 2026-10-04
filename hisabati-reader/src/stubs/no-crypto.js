// mdb-reader only needs hashing/AES for password-protected files. حساباتي
// files are not encrypted, so these stubs keep Node's stream/crypto shims out
// of the bundle and fail clearly if an encrypted file is ever opened.
function unsupported() {
  throw new Error('الملف محمي بكلمة سر، وهذا البرنامج ما يدعم الملفات المحمية.');
}
export default unsupported;
export const createDecipheriv = unsupported;
export const createCipheriv = unsupported;
