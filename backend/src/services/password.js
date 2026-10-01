import bcrypt from 'bcryptjs';
export const hashPassword = (p) => bcrypt.hash(p, 12);
export const checkPassword = (p, h) => bcrypt.compare(p, h);
// Used to equalise timing when the account does not exist.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export function adminPasswordProblem(pw, email) {
  if (pw.length < 12) return 'password_too_short';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) return 'password_too_weak';
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'password_contains_email';
  return null;
}
