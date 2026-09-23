-- Hand-written (design part 04 §22.5). Structural anonymity: for an anonymous campaign a
-- submission may carry neither a respondent nor an invitation id, and its submitted_at is
-- day-truncated so it cannot be correlated with the invitation that produced it. The rule is
-- enforced in the database, not only in the service, because "no path from invitation to
-- response" is the guarantee the whole evaluation module rests on.

CREATE FUNCTION enforce_submission_anonymity() RETURNS trigger AS $$
DECLARE mode text;
BEGIN
  IF NEW.campaign_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT anonymity_mode::text INTO mode FROM campaign WHERE id = NEW.campaign_id;
  IF mode IS NULL THEN
    RETURN NEW;
  END IF;
  IF mode = 'anonymous' THEN
    IF NEW.respondent_person_id IS NOT NULL OR NEW.invitation_id IS NOT NULL THEN
      RAISE EXCEPTION 'an anonymous submission may not carry a respondent or an invitation'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.submitted_at IS NOT NULL AND NEW.submitted_at <> date_trunc('day', NEW.submitted_at) THEN
      RAISE EXCEPTION 'an anonymous submission must carry a day-truncated submitted_at'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF mode = 'pseudonymous' AND NEW.respondent_person_id IS NOT NULL THEN
    RAISE EXCEPTION 'a pseudonymous submission may not carry a respondent'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submission_anonymity BEFORE INSERT OR UPDATE ON "submission"
  FOR EACH ROW EXECUTE FUNCTION enforce_submission_anonymity();

-- The same day-truncation for the invitation side of an anonymous campaign.
CREATE FUNCTION enforce_invitation_anonymity() RETURNS trigger AS $$
DECLARE mode text;
BEGIN
  SELECT anonymity_mode::text INTO mode FROM campaign WHERE id = NEW.campaign_id;
  IF mode = 'anonymous' AND NEW.submitted_at IS NOT NULL
     AND NEW.submitted_at <> date_trunc('day', NEW.submitted_at) THEN
    RAISE EXCEPTION 'an anonymous invitation must carry a day-truncated submitted_at'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaign_invitation_anonymity BEFORE INSERT OR UPDATE ON "campaign_invitation"
  FOR EACH ROW EXECUTE FUNCTION enforce_invitation_anonymity();

-- One submitted response per invitation unless the campaign allows several.
CREATE UNIQUE INDEX submission_one_per_invitation
  ON "submission" ("invitation_id") WHERE "invitation_id" IS NOT NULL AND "status" = 'submitted';
