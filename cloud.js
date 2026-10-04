(() => {
  'use strict';

  const CONFIG_KEY = 'tabaja_cloud_config_dev_v101';
const ACCOUNT_KEY = 'tabaja_card_designer_account_dev_v10';
  const ADMIN_USER_ID = '8c9ab1ff-b7a2-4a38-a789-76a252014b4e';
  const DEFAULT_CONFIG = Object.freeze({
    url: 'https://jpdpzkvddwprwrngnjyr.supabase.co',
    anonKey: 'sb_publishable_ODDyjXOXWjdDb1Djq6HLqw_u_NB28Lz'
  });
  let client = null;

  function readConfig() {
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      if (stored !== null) return JSON.parse(stored) || {};
      return { ...DEFAULT_CONFIG };
    } catch { return { ...DEFAULT_CONFIG }; }
  }

  function saveConfig(config) {
    const clean = {
      url: String(config.url || '').trim().replace(/\/$/, ''),
      anonKey: String(config.anonKey || '').trim()
    };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
    client = null;
    return clean;
  }

  function isConfigured() {
    const config = readConfig();
    return /^https:\/\/.+\.supabase\.co$/i.test(config.url || '') && (config.anonKey || '').length > 40;
  }

  function getClient() {
    if (!isConfigured() || !window.supabase) return null;
    if (!client) {
      const config = readConfig();
      client = window.supabase.createClient(config.url, config.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return client;
  }

  async function getSession() {
    const supabase = getClient();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function loadWorkspace(userId) {
    const supabase = getClient();
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('company_members')
      .select('role, companies(id,name,country,phone,plan,status,licence_expires_at,max_users,trial_started_at,trial_expires_at,feature_nfc,feature_batch,feature_qr,feature_barcode,feature_elements)')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const company = data?.companies;
    if (!company) return null;

    return {
      company: company.name,
      companyId: company.id,
      country: company.country || '',
      phone: company.phone || '',
      plan: company.plan || 'Professional',
      status:
        String(company.status || 'active').toLowerCase() === 'suspended'
          ? 'SUSPENDED'
          : String(company.status || 'active').toLowerCase() === 'expired'
            ? 'EXPIRED'
            : (company.trial_expires_at ? 'TRIAL' : 'ACTIVE'),
      licenceExpiresAt: company.licence_expires_at || null,
      maxUsers: company.max_users || 1,
      trialStartedAt: company.trial_started_at || null,
      trialExpiresAt: company.trial_expires_at || company.licence_expires_at || null,
      features: {
        nfc: company.feature_nfc === true,
        batch: company.feature_batch === true,
        qr: company.feature_qr === true,
        barcode: company.feature_barcode === true,
        elements: company.feature_elements === true
      },
      role: data.role || 'owner'
    };
  }

  async function createWorkspaceForUser(user, fallback = {}) {
    const supabase = getClient();
    if (!supabase || !user?.id) return null;

    // FIX 5.4: make sure the authenticated session is ready.
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    const sessionUser = sessionData?.session?.user;
    if (!sessionUser?.id) {
      throw new Error('Authenticated session is not ready. Please sign in again.');
    }

    const { data: verifiedData, error: verifiedError } = await supabase.auth.getUser();
    if (verifiedError) throw verifiedError;

    const authenticatedUser = verifiedData?.user;

    if (!authenticatedUser?.id || authenticatedUser.id !== sessionUser.id) {
      throw new Error('Authenticated user could not be verified. Please sign in again.');
    }

    user = authenticatedUser;

    // Never create another workspace if this user already has one.
    const existing = await loadWorkspace(user.id);
    if (existing) return existing;

    const meta = user.user_metadata || {};

    const companyName = String(
      meta.company || fallback.company || ''
    ).trim();

    const country = String(
      meta.country || fallback.country || ''
    ).trim();

    const phone = String(
      meta.phone || fallback.phone || ''
    ).trim();

    const trialStartedAt = new Date().toISOString();
    const trialExpiresAt = new Date(
      Date.now() + 5 * 86400000
    ).toISOString();

    // FIX 5.6.2:
    // Provision the company + initial owner membership through the
    // SECURITY DEFINER RPC instead of a direct INSERT into companies.
    // RLS remains enabled.
    if (!companyName) {
      throw new Error('Company name is missing from the confirmed account.');
    }

    const { error: provisionError } = await supabase.rpc(
      'provision_my_company',
      {
        p_name: companyName,
        p_country: country,
        p_phone: phone,
        p_trial_started_at: trialStartedAt,
        p_trial_expires_at: trialExpiresAt
      }
    );

    if (provisionError) throw provisionError;

    // Reload the workspace created by the RPC.
    const workspace = await loadWorkspace(user.id);

    if (!workspace) {
      throw new Error(
        'Company workspace provisioning did not complete. Please sign in again.'
      );
    }

    return workspace;
  }

  async function signIn(email, password) {
    const supabase = getClient();

    if (!supabase) {
      throw new Error('Cloud is not configured. Open Cloud Setup first.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // Bind the authenticated session before provisioning.
    if (data.session?.access_token && data.session?.refresh_token) {
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token
      });

      if (setSessionError) throw setSessionError;
    }

    if (data.user?.id === ADMIN_USER_ID) {
      return {
        cloudAdmin: true,
        userId: data.user.id,
        email: data.user.email,
        cloud: true
      };
    }

    let workspace = await loadWorkspace(data.user.id);

    if (!workspace) {
      workspace = await createWorkspaceForUser(data.user);
    }

    const account = {
      ...(workspace || {}),
      owner: data.user.user_metadata?.full_name || data.user.email,
      email: data.user.email,
      cloud: true
    };

    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));

    return account;
  }

  async function signUp(payload) {
    const supabase = getClient();

    if (!supabase) {
      throw new Error('Cloud is not configured. Open Cloud Setup first.');
    }

    const redirectTo = `${location.origin}${location.pathname}`;

    const { data, error } = await supabase.auth.signUp({
      email: payload.email,
      password: payload.password,
      options: {
        emailRedirectTo: redirectTo,
        data: {
          full_name: payload.owner,
          company: payload.company,
          country: payload.country,
          phone: payload.phone
        }
      }
    });

    if (error) throw error;

    if (!data.user) {
      throw new Error('Account creation did not return a user.');
    }

    // Signup only creates the Auth account.
    // Company provisioning happens after email confirmation,
    // on the first successful authenticated sign-in.
    return {
      pendingConfirmation: true,
      email: payload.email
    };
  }

  async function signOut() {
    const supabase = getClient();
    if (supabase) await supabase.auth.signOut();
  }

  async function updatePassword(password) {
    const supabase = getClient();

    if (!supabase) {
      throw new Error('Cloud is not configured.');
    }

    if (String(password || '').length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }

    const { data, error } = await supabase.auth.updateUser({
      password
    });

    if (error) throw error;

    return data.user || null;
  }

  async function resetPassword(email) {
    const supabase = getClient();

    if (!supabase) {
      throw new Error('Cloud is not configured.');
    }

    const redirectTo = `${location.origin}${location.pathname}`;

    const { error } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo }
    );

    if (error) throw error;
  }

  async function connectionTest(config) {
    saveConfig(config);

    const supabase = getClient();

    if (!supabase) {
      throw new Error(
        'The Supabase URL or anon key format is invalid.'
      );
    }

    const { error } = await supabase.auth.getSession();

    if (error) throw error;

    return true;
  }
async function saveTemplateToCloud(companyId, name, snapshotJson) {
  const supabase = getClient();

  if (!supabase) {
    throw new Error('Cloud is not configured.');
  }

  if (!companyId) {
    throw new Error('Company ID is required.');
  }

  const templateData =
    typeof snapshotJson === 'string'
      ? JSON.parse(snapshotJson)
      : snapshotJson;

  

  const { data, error } = await supabase
    .from('templates')
    .insert({
      company_id: companyId,
      name: name || 'Identity Card',
      template_data: templateData
    })
    .select('id')
    .single();

  if (error) throw error;

  return data.id;
}

async function loadTemplateFromCloud(companyId, name = 'Identity Card') {
  const supabase = getClient();

  if (!supabase) {
    throw new Error('Cloud is not configured.');
  }

  if (!companyId) {
    throw new Error('Company ID is required.');
  }

  const { data, error } = await supabase
    .from('templates')
    .select('template_data')
    .eq('company_id', companyId)
    .eq('name', name)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.template_data) return null;

  return JSON.stringify(data.template_data);
}

  async function listTemplatesFromCloud(companyId) {
  const supabase = getClient();

  if (!supabase) {
    throw new Error('Cloud is not configured.');
  }

  if (!companyId) {
    throw new Error('Company ID is required.');
  }

  const { data, error } = await supabase
    .from('templates')
    .select('id, name, created_at, updated_at')
    .eq('company_id', companyId)
    .order('updated_at', { ascending: false });

  if (error) throw error;

  return Array.isArray(data) ? data : [];
}

  async function saveEmployeeToCloud(companyId, employee) {
  const supabase = getClient();

  if (!supabase) {
    throw new Error('Cloud is not configured.');
  }

  if (!companyId) {
    throw new Error('Company ID is required.');
  }

  const employeeCode = String(employee.employeeId || '').trim();

  const employeeData = {
    company_id: companyId,
    employee_code: employeeCode,
    full_name: [employee.firstName, employee.lastName]
      .filter(Boolean)
      .join(' ')
      .trim(),
    first_name: employee.firstName || '',
    last_name: employee.lastName || '',
    department: employee.department || '',
    job_title: employee.jobTitle || '',
    company_name: employee.company || '',
    email: employee.email || '',
    phone: employee.phone || '',
    photo_url: '',
    photo_data: employee.photo || '',
    status: (employee.status || 'Active').toLowerCase()
  };

  let cloudId = employee.id || null;

  // A Cloud-loaded employee uses the Supabase UUID as its local key.
  if (!cloudId && employee.key) {
    const { data: byKey, error: keyError } = await supabase
      .from('employees')
      .select('id')
      .eq('id', employee.key)
      .eq('company_id', companyId)
      .limit(1)
      .maybeSingle();

    if (keyError) throw keyError;

    cloudId = byKey?.id || null;
  }

  // Existing employee: update by permanent Supabase UUID.
  if (cloudId) {
    const { error } = await supabase
      .from('employees')
      .update(employeeData)
      .eq('id', cloudId)
      .eq('company_id', companyId);

    if (error) throw error;

    return cloudId;
  }

  // New / legacy record: employee code is only used to avoid
  // a duplicate on the first Cloud save.
  const { data: existing, error: lookupError } = await supabase
    .from('employees')
    .select('id')
    .eq('company_id', companyId)
    .eq('employee_code', employeeCode)
    .eq('is_deleted', false)
    .limit(1)
    .maybeSingle();

  if (lookupError) throw lookupError;

  if (existing?.id) {
    const { error } = await supabase
      .from('employees')
      .update(employeeData)
      .eq('id', existing.id)
      .eq('company_id', companyId);

    if (error) throw error;

    return existing.id;
  }

  const { data, error } = await supabase
    .from('employees')
    .insert(employeeData)
    .select('id')
    .single();

  if (error) throw error;

  return data.id;
}
  async function loadEmployeePaymentProfile(companyId, employeeId) {
  const supabase = getClient();
  if (!supabase || !companyId || !employeeId) return null;
  const { data, error } = await supabase
    .from('employee_payment_profiles')
    .select('payment_method,account_name,afrimoney_number,bank_name,bank_account_number,updated_at')
    .eq('company_id', companyId)
    .eq('employee_id', employeeId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadEmployeePayrollReadiness(companyId, employeeId) {
  const supabase = getClient();
  if (!supabase || !companyId || !employeeId) return null;
  const [salaryResult, transportResult, paymentResult] = await Promise.all([
    supabase.from('wf_employee_salary_history').select('approval_status,effective_from').eq('company_id', companyId).eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1),
    supabase.from('wf_transport_employee_overrides').select('approval_status,effective_from,is_active').eq('company_id', companyId).eq('employee_id', employeeId).order('effective_from', { ascending: false }).limit(1),
    supabase.from('employee_payment_profiles').select('payment_method').eq('company_id', companyId).eq('employee_id', employeeId).maybeSingle()
  ]);
  if (salaryResult.error) throw salaryResult.error;
  if (transportResult.error) throw transportResult.error;
  if (paymentResult.error) throw paymentResult.error;
  const salary = salaryResult.data?.[0]?.approval_status || 'missing';
  const transport = transportResult.data?.[0]?.approval_status || 'missing';
  const paymentMethod = paymentResult.data?.payment_method || '';
  return {
    salary,
    transport,
    paymentMethod,
    ready: salary === 'approved' && transport === 'approved' && !!paymentMethod
  };
}

async function saveEmployeePaymentProfile(companyId, employeeId, profile) {
  const supabase = getClient();
  if (!supabase) throw new Error('Cloud is not configured.');
  if (!companyId || !employeeId) throw new Error('Company ID and Employee ID are required.');
  const method = String(profile?.paymentMethod || '').trim().toLowerCase() || null;
  if (method && !['afrimoney','bank','cash'].includes(method)) throw new Error('Invalid payment method.');
  const payload = {
    company_id: companyId,
    employee_id: employeeId,
    payment_method: method,
    account_name: String(profile?.accountName || '').trim() || null,
    afrimoney_number: method === 'afrimoney' ? (String(profile?.afrimoneyNumber || '').trim() || null) : null,
    bank_name: method === 'bank' ? (String(profile?.bankName || '').trim() || null) : null,
    bank_account_number: method === 'bank' ? (String(profile?.bankAccountNumber || '').trim() || null) : null,
    updated_by: (await supabase.auth.getUser()).data?.user?.id || null,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('employee_payment_profiles').upsert(payload, { onConflict: 'company_id,employee_id' });
  if (error) throw error;
  return true;
}

  async function archiveEmployeeInCloud(companyId, employeeId) {
  const supabase = getClient();

  if (!supabase) {
    throw new Error('Cloud is not configured.');
  }

  if (!companyId || !employeeId) {
    throw new Error('Company ID and Employee ID are required.');
  }

  const { error } = await supabase
    .from('employees')
    .update({ is_deleted: true })
    .eq('id', employeeId)
    .eq('company_id', companyId);

  if (error) throw error;

  return true;
}
  async function loadEmployeesFromCloud(companyId) {
  const supabase = getClient();

  if (!supabase) {
    throw new Error('Cloud is not configured.');
  }

  if (!companyId) {
    throw new Error('Company ID is required.');
  }

  const { data, error } = await supabase
    .from('employees')
    .select(`
      id,
      employee_code,
      first_name,
      last_name,
      department,
      job_title,
      company_name,
      email,
      phone,
      photo_data,
      status,
      created_at
    `)
    .eq('company_id', companyId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data || []).map((row) => ({
  id: row.id,
  key: row.id,
  employeeId: row.employee_code || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    department: row.department || '',
    jobTitle: row.job_title || '',
    company: row.company_name || '',
    email: row.email || '',
    phone: row.phone || '',
    photo: row.photo_data || '',
    status:
      String(row.status || 'active').toLowerCase() === 'inactive'
        ? 'Inactive'
        : 'Active',
    createdAt: row.created_at || ''
  }));
}
  window.TabajaCloud = {
    readConfig,
    saveConfig,
    isConfigured,
    getClient,
    getSession,
    loadWorkspace,
    createWorkspaceForUser,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
    connectionTest,
    saveEmployeeToCloud,
    loadEmployeePaymentProfile,
    loadEmployeePayrollReadiness,
    saveEmployeePaymentProfile,
    archiveEmployeeInCloud,
    loadEmployeesFromCloud,
saveTemplateToCloud,
loadTemplateFromCloud,
listTemplatesFromCloud,
ADMIN_USER_ID
  };
})();
