-- Add trigger to track API calls automatically
CREATE OR REPLACE FUNCTION track_api_call()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO api_usage (user_id, path, method, status_code, response_time_ms, ip_address)
    VALUES (NEW.user_id, NEW.path, NEW.method, NEW.status_code, NEW.response_time_ms, NEW.ip_address);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update users table with request tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_requests INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_request_at TIMESTAMP;

-- Update routes table with approved tracking
ALTER TABLE routes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS approved_by UUID;

-- Create approved_today function
CREATE OR REPLACE FUNCTION get_approved_today()
RETURNS INTEGER AS $$
DECLARE
    today_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO today_count
    FROM routes
    WHERE approved_at::DATE = CURRENT_DATE;
    RETURN today_count;
END;
$$ LANGUAGE plpgsql;

-- Create api_calls_30d function
CREATE OR REPLACE FUNCTION get_api_calls_30d()
RETURNS INTEGER AS $$
DECLARE
    call_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO call_count
    FROM api_usage
    WHERE created_at > NOW() - INTERVAL '30 days';
    RETURN call_count;
END;
$$ LANGUAGE plpgsql;

SELECT '✅ Tracking functions added!' as status;
