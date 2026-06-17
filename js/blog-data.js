import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mgvngrtvwlvqtkxbwtnx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndm5ncnR2d2x2cXRreGJ3dG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTU5NzAsImV4cCI6MjA5NzI3MTk3MH0.ejiZcHa8ozmqK0BOmRHQQ7Zadquu5mzyVRciZ7o19oY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const publishedPostFilter = 'slug,title,excerpt,cover_image_url,cover_image_alt,read_minutes,published_at,meta_title,meta_description,canonical_path,content_html,blog_categories(slug,name,color_class,sort_order)';

export async function fetchBlogCategories() {
  const { data, error } = await supabase
    .from('blog_categories')
    .select('slug,name,color_class,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function fetchPublishedBlogPosts() {
  const { data, error } = await supabase
    .from('blog_posts')
    .select(publishedPostFilter)
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function fetchPublishedBlogPost(slug) {
  const { data, error } = await supabase
    .from('blog_posts')
    .select(publishedPostFilter)
    .eq('slug', slug)
    .eq('status', 'published')
    .lte('published_at', new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function formatPublishedDate(value) {
  if (!value) return '';

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

export function getPostCategory(post) {
  return post?.blog_categories ?? null;
}
