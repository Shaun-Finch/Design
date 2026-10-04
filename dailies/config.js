/* Dailies team sync.
   Paste your Supabase project's URL and anon (public) key below to turn on sign-in and shared team boards.
   Both are safe to publish: the database rules in dailies-setup.sql decide who can see what.
   Find them in Supabase: Project Settings > API (Project URL, and the anon / publishable key).
   Leave them empty and Dailies runs as a single-device board saved in the browser. */
window.DAILIES_CONFIG = {
  supabaseUrl: 'https://gflbddyeelsvazhtcazl.supabase.co',
  supabaseAnonKey: 'sb_publishable_FRVImF__Pb9KH4bcbnU8dQ_csHKYDBe',
  // Set to true once you have connected your own email sender (Supabase > Authentication > SMTP),
  // so people can reset a forgotten password by email.
  passwordResetEmails: false
};
