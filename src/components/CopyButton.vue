<template>
  <v-btn
    class="copy-button"
    :color="copyColor"
    :size="size"
    :density="density"
    :variant="variant"
    :title="buttonTitle"
    :aria-label="buttonTitle"
    :disabled="resolvedDisabled"
    v-bind="buttonProps"
    @click.prevent.stop="copy"
  >
    <v-icon v-if="!$slots.default" :icon="copyIcon" />
    <slot />
  </v-btn>
</template>

<script>
import { useClipboard } from '@vueuse/core';

export default {
  name: 'CopyButton',
  props: {
    copyText: {
      type: String,
      required: true
    },
    variant: {
      type: String,
      default: 'primary'
    },
    size: {
      type: String,
      default: 'default'
    },
    density: {
      type: String,
      default: 'default'
    },
    buttonProps: {
      type: Object,
      default: () => ({})
    }
  },
  data() {
    return {
      status: null
    };
  },
  setup() {
    const { copy, isSupported } = useClipboard();
    return {
      copyToClipboard: copy,
      isClipboardSupportedState: isSupported
    };
  },
  computed: {
    isClipboardSupported() {
      return Boolean(this.isClipboardSupportedState);
    },
    resolvedDisabled() {
      return Boolean(this.buttonProps?.disabled) || !this.isClipboardSupported;
    },
    copyColor() {
      if (!this.isClipboardSupported) return undefined;
      if (this.status === true) return 'success';
      if (this.status === false) return 'error';
      return undefined;
    },
    copyIcon() {
      if (!this.isClipboardSupported || this.status === false) {
        return 'mdi-clipboard-off-outline';
      }
      if (this.status === true) {
        return 'mdi-clipboard-check-outline';
      }
      return 'mdi-clipboard-outline';
    },
    buttonTitle() {
      if (!this.isClipboardSupported) {
        return 'Clipboard not supported';
      }
      if (this.status === false) {
        return 'Copy failed: permission denied';
      }
      return 'Copy';
    }
  },
  methods: {
    async copy() {
      const focusedElement = typeof document !== 'undefined' ? document.activeElement : null;
      try {
        if (!this.isClipboardSupported) {
          throw new Error('Clipboard not supported');
        }
        await this.copyToClipboard(this.copyText);
        this.status = true;
      } catch (error) {
        console.error('Copy failed:', error);
        this.status = false;
      } finally {
        if (focusedElement && typeof focusedElement.focus === 'function') {
          focusedElement.focus();
        }
        setTimeout(() => {
          this.status = null;
        }, 3000);
      }
    }
  }
};
</script>
