update users
set password_hash = 'scrypt$7b4688a4357c4338a74c5e332131bee5$ba00bab431b5e7d13696cea3194a6c0bda2b4c044cb365e29d81b96a8ea4e3ed'
where role = 'admin' and username = 'admin';
