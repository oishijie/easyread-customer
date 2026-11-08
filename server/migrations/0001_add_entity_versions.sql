-- 0001: 为同步 LWW 引入每条数据的版本号（客户端改动时间戳）。
-- 旧列允许 NULL：NULL 视为 0，任何带版本的新写入都会胜出。
ALTER TABLE read_laters ADD COLUMN updated_at INTEGER;
ALTER TABLE all_records ADD COLUMN updated_at INTEGER;
ALTER TABLE favorites ADD COLUMN updated_at INTEGER;
