-- 002_add_physical_activities.sql
-- 체육 활동 기록(physical_records) 테이블을 생성합니다.
-- 셔틀런 왕복 횟수와 서킷 트레이닝 소요 시간(초)을 저장합니다.

CREATE TABLE IF NOT EXISTS physical_records (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL,
  activity_type TEXT NOT NULL, -- 'shuttlerun' 또는 'circuit'
  score         INTEGER NOT NULL, -- 셔틀런: 왕복 횟수, 서킷: 소요 시간(초)
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_physical_records_date ON physical_records (recorded_at);
