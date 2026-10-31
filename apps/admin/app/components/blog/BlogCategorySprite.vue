<script setup lang="ts">
import { computed } from 'vue'
import { blogCategorySprite } from '@/utils/blog-category-sprites'

const props = withDefaults(defineProps<{
  iconKey?: string | null
  play?: 'hover' | 'always' | 'off'
}>(), { iconKey: null, play: 'hover' })

const sprite = computed(() => blogCategorySprite(props.iconKey))
const style = computed(() => ({
  '--sprite-tint': sprite.value.tint,
  '--sprite-distance': String(sprite.value.motion.distance ?? 1),
}))
</script>

<template>
  <span class="blog-sprite-tile" :style="style" :data-play="play" :data-motion="sprite.motion.kind">
    <svg class="blog-sprite" viewBox="0 0 20 20" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
      <rect
        v-for="([x, y, width, height, tone], index) in sprite.base" :key="`base-${index}`"
        :x="x" :y="y" :width="width" :height="height" :class="`
          blog-sprite__${tone}
        `"
      />
      <g
        v-for="(frame, frameIndex) in sprite.motion.frames" :key="`frame-${frameIndex}`" class="
          blog-sprite__motion
        " :data-frame="frameIndex"
      >
        <rect
          v-for="([x, y, width, height, tone], index) in frame" :key="`motion-${frameIndex}-${index}`"
          :x="x" :y="y" :width="width" :height="height" :class="`
            blog-sprite__${tone}
          `"
        />
      </g>
    </svg>
  </span>
</template>
