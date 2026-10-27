import { createApp, h } from 'vue'
import JudgingWorkspace from '../../admin/app/components/judging/JudgingWorkspace.vue'
import './styles.css'

createApp({
  render: () => h(JudgingWorkspace, {
    apiBase: '/api/local',
    local: true,
  }),
}).mount('#app')
