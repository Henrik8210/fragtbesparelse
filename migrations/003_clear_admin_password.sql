update users
set password_hash = null
where role = 'admin' and username = 'admin';
