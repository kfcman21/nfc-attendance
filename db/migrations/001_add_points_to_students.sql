-- 001_add_points_to_students.sql
-- 학생(students) 테이블에 칭찬 포인트(points) 컬럼을 추가합니다.
-- 기본값은 0으로 지정합니다.

ALTER TABLE students ADD COLUMN points INTEGER DEFAULT 0;
