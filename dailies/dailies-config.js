/*
  Dailies settings.

  promptDoc: link to your Google Doc of the Dailies prompt.
    Leave it empty and "The Dailies prompt" opens prompt.html in this folder.

  url + anonKey: your Supabase Project URL and publishable (anon) key.
    Leave both empty and Dailies works on each visitor's own device.
    Fill them in to turn on shared, live team workspaces.
    Both are safe to publish: the database's security rules decide who can see what.
*/
window.DAILIES_CONFIG = {
  promptDoc: "",
  url: "",
  anonKey: ""
};
