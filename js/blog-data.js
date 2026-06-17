import { supabase } from './supabase-client.js';

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
