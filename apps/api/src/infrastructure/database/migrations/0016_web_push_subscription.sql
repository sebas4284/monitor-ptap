-- Browser subscriptions are owned by the current account and browser session binding.
CREATE TABLE IF NOT EXISTS web_push_subscription (
  endpoint_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  endpoint VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) NOT NULL,
  p256dh VARCHAR(87) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  auth VARCHAR(22) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  binding CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (endpoint_hash),
  KEY idx_web_push_user (user_id),
  CONSTRAINT fk_web_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
