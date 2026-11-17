-- Seats the team grants a member's code on top of MEMBER_CODE_SEATS, such
-- as for a community lead who shares the code with a whole group.
ALTER TABLE wallets ADD COLUMN bonus_seats integer NOT NULL DEFAULT 0 CHECK (bonus_seats >= 0);
