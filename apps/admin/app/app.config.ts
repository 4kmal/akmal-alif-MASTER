export default defineAppConfig({
  title: 'Akmal Alif / Admin',
  documentation: 'https://github.com/4kmal/akmal-alif-MASTER/tree/main/apps/admin',
  github: 'https://github.com/4kmal/akmal-alif-MASTER',
  siteUrl: 'https://www.akmalalif.com/',
  twitter: '',
  telegram: '',
  description: 'Private portfolio briefing, analytics, and shortlink operations.',
  image: '/admin/icon-192.png',
  previewTTL: 300, // 5 minutes
  slugRegex: /^[a-z0-9]+(?:-[a-z0-9]+)*$/i,
  reserveSlug: [
    'admin',
    'dashboard',
  ],
})
