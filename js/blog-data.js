async function requestJson(path) {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Blog request failed (${response.status})`);
  }

  return response.json();
}

export async function fetchBlogCategories() {
  return (await requestJson('/api/blog/categories')) ?? [];
}

export async function fetchPublishedBlogPosts() {
  return (await requestJson('/api/blog/posts')) ?? [];
}

export async function fetchPublishedBlogPost(slug) {
  return requestJson(`/api/blog/posts/${encodeURIComponent(slug)}`);
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
