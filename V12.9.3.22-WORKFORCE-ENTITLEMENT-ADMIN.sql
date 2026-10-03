-- TABAJA SOLUTION D2 DEV
-- V12.9.3.22 - Workforce & Payroll module entitlement control
-- DEV ONLY. Does not alter Smart Identity tables or behavior.

BEGIN;

CREATE OR REPLACE FUNCTION public.wf_platform_list_entitlements()
RETURNS TABLE(company_id uuid, enabled boolean, plan text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF NOT public.wf_is_platform_admin() THEN
        RAISE EXCEPTION 'Platform Admin access required.';
    END IF;

    RETURN QUERY
    SELECT e.company_id, e.enabled, e.plan
    FROM public.wf_company_entitlements e;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wf_platform_set_entitlement(
    target_company uuid,
    target_enabled boolean,
    target_plan text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    IF NOT public.wf_is_platform_admin() THEN
        RAISE EXCEPTION 'Platform Admin access required.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = target_company) THEN
        RAISE EXCEPTION 'Company not found.';
    END IF;

    INSERT INTO public.wf_company_entitlements (company_id, enabled, plan)
    VALUES (
        target_company,
        COALESCE(target_enabled, false),
        CASE WHEN COALESCE(target_enabled, false) THEN COALESCE(NULLIF(trim(target_plan), ''), 'WORKFORCE') ELSE NULL END
    )
    ON CONFLICT (company_id)
    DO UPDATE SET
        enabled = EXCLUDED.enabled,
        plan = EXCLUDED.plan;

    RETURN COALESCE(target_enabled, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.wf_platform_list_entitlements() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wf_platform_set_entitlement(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wf_platform_list_entitlements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wf_platform_set_entitlement(uuid, boolean, text) TO authenticated;

COMMIT;

-- Verification: should return two functions.
SELECT proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN ('wf_platform_list_entitlements','wf_platform_set_entitlement')
ORDER BY proname;
