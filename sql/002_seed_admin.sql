-- Seed your first admin user. The app cannot self-signup without an invite token,
-- so you bootstrap yourself here, then mint tokens for everyone else via /admin.
--
-- Generate a password hash by running, from the project root:
--   node -e "import('@node-rs/argon2').then(({hash})=>hash(process.argv[1]).then(console.log))" 'your-password-here'
--
-- Then replace the placeholders below and run this file.

INSERT INTO tandem.users (email, display_name, password_hash, is_admin)
VALUES (
  'ckhawks@gmailcom',
  'ckhawks',
  '$argon2id$v=19$m=19456,t=2,p=1$wH451pFajZ9Q33dvvum8yw$TwhAt0HHFuwIeCHJpleUbyPEWHvQoVMPrKGgvxjdRic',
  true
)
ON CONFLICT (email) DO NOTHING;
