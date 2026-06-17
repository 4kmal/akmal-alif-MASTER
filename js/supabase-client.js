import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mgvngrtvwlvqtkxbwtnx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndm5ncnR2d2x2cXRreGJ3dG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTU5NzAsImV4cCI6MjA5NzI3MTk3MH0.ejiZcHa8ozmqK0BOmRHQQ7Zadquu5mzyVRciZ7o19oY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
