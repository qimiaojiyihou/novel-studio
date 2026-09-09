<template>
  <svg
    class="app-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <g stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
      <template v-if="name === 'writing'">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
        <path d="M8 7h8M8 11h6" />
      </template>
      <template v-else-if="name === 'assistant'">
        <path d="m12 3 1.1 3.3a6.3 6.3 0 0 0 4 4L20.5 12l-3.4 1.1a6.3 6.3 0 0 0-4 4L12 20.5l-1.1-3.4a6.3 6.3 0 0 0-4-4L3.5 12l3.4-1.1a6.3 6.3 0 0 0 4-4L12 3Z" />
      </template>
      <template v-else-if="name === 'foundation'">
        <path d="M4 19.5c4-1 7-3.2 9.2-6.5C15.4 9.8 16.6 6.6 20 4c-.3 4.4-1.7 8.1-4.6 10.8C12.6 17.4 8.8 19 4 19.5Z" />
        <path d="M6.5 17.7c2.7-2.8 5.6-5.2 9-7.2" />
      </template>
      <template v-else-if="name === 'characters'">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </template>
      <template v-else-if="name === 'world'">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </template>
      <template v-else-if="name === 'outline'">
        <path d="M6 3v12M18 9v12" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="6" r="3" />
        <path d="M9 6h3a6 6 0 0 1 6 6v6" />
      </template>
      <template v-else-if="name === 'knowledge'">
        <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H11v16H5.5A2.5 2.5 0 0 0 3 21.5v-16Z" />
        <path d="M21 5.5A2.5 2.5 0 0 0 18.5 3H13v16h5.5a2.5 2.5 0 0 1 2.5 2.5v-16Z" />
      </template>
      <template v-else-if="name === 'prompts'">
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </template>
      <template v-else-if="name === 'history'">
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
      </template>
      <template v-else-if="name === 'settings'">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.37.34.7.6 1 .3.27.7.4 1.1.4h.1v4h-.1c-.4 0-.8.13-1.1.4-.26.3-.47.63-.6 1Z" />
      </template>
      <template v-else-if="name === 'change'">
        <path d="M8 7h9a4 4 0 0 1 4 4v1M16 3l-4 4 4 4" />
        <path d="M16 17H7a4 4 0 0 1-4-4v-1M8 21l4-4-4-4" />
      </template>
      <template v-else-if="name === 'quality'">
        <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10Z" />
        <path d="m8.5 12 2.2 2.2 4.8-5" />
      </template>
      <template v-else-if="name === 'codex'">
        <path d="M8 4h8l4 4v8l-4 4H8l-4-4V8l4-4Z" />
        <path d="m9 9-3 3 3 3M15 9l3 3-3 3M13 7l-2 10" />
      </template>
      <template v-else-if="name === 'focus'">
        <path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5" />
        <path d="M8 9h8M8 13h8M8 17h4" />
      </template>
      <template v-else-if="name === 'panel'">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16M18 8h.01M18 12h.01" />
      </template>
      <template v-else-if="name === 'database'">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
      </template>
      <template v-else>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12h8" />
      </template>
    </g>
  </svg>
</template>

<script setup>
defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
})
</script>
