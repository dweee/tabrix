<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke-width="1.8"
    stroke="currentColor"
    :class="className"
  >
    <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v9" />
    <path stroke-linecap="round" stroke-linejoin="round" d="M7.05 6.95a7 7 0 1 0 9.9 0" />
  </svg>
</template>

<script lang="ts" setup>
interface Props {
  className?: string;
}

withDefaults(defineProps<Props>(), {
  className: 'icon-default',
});
</script>
