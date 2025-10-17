<template>
  <div class="modal" @mousedown="backgroundClose" :style="{ 'z-index': zIndex }">
    <component
      :is="containerTag"
      ref="container"
      class="modal-container"
      :class="{ smooth: smooth }"
      :style="style"
      @submit.prevent.stop="submit"
    >
      <header class="modal-header" @mousedown="startMove">
        <slot name="header">
          <h2>{{ title }}</h2>
          <span class="close" @click="close">&times;</span>
        </slot>
      </header>
      <main class="modal-content">
        <slot></slot>
      </main>
      <footer class="modal-footer">
        <slot name="footer">
          <button v-if="canSubmit" type="submit">{{ submitButtonText }}</button>
        </slot>
      </footer>
    </component>
  </div>
</template>

<script>
export default {
  name: 'BaseModal',
  props: {
    title: {
      type: String,
      default: null
    },
    minWidth: {
      type: String,
      default: null
    },
    width: {
      type: String,
      default: 'auto'
    },
    show: {
      type: Boolean,
      default: true
    },
    submitButtonText: {
      type: String,
      default: 'Submit'
    },
    zIndex: {
      type: Number,
      default: 1000
    }
  },
  data() {
    return {
      position: null,
      dragPosition: null,
      smooth: false
    };
  },
  computed: {
    canSubmit() {
      return Boolean(this.$attrs.onSubmit);
    },
    submit() {
      if (this.canSubmit) {
        return () => this.$emit('submit');
      } else {
        return () => {};
      }
    },
    style() {
      let style = {
        width: this.width
      };
      if (this.minWidth) {
        style['min-width'] = this.minWidth;
      }
      if (Array.isArray(this.position)) {
        style.position = 'absolute';
        style.left = this.position[0] + 'px';
        style.top = this.position[1] + 'px';
      }
      return style;
    },
    containerTag() {
      return this.canSubmit ? 'form' : 'div';
    }
  },
  watch: {
    show: {
      immediate: true,
      handler(show) {
        if (!show) {
          this.close();
        } else {
          this.open();
        }
      }
    },
    width() {
      this.smoothResize();
    },
    minWidth() {
      this.smoothResize();
    }
  },
  methods: {
    smoothResize() {
      this.smooth = true;
      setTimeout(() => (this.smooth = false), 600);
    },
    open() {
      window.addEventListener('keydown', this.escCloseListener);
      this.$emit('show');
    },
    close() {
      window.removeEventListener('keydown', this.escCloseListener);
      this.$emit('close');
    },
    startMove(event) {
      if (event.target.tagName !== 'H2') {
        this.dragPosition = [event.clientX, event.clientY];

        document.addEventListener('mousemove', this.move);
        document.addEventListener('mouseup', this.stopMove);

        event.preventDefault();
        event.stopPropagation();
      }
    },
    stopMove() {
      document.removeEventListener('mousemove', this.move);
      document.removeEventListener('mouseup', this.stopMove);
    },
    move(event) {
      event.preventDefault();
      // set the element's new position
      this.position = [
        this.$refs.container.offsetLeft - (this.dragPosition[0] - event.clientX),
        this.$refs.container.offsetTop - (this.dragPosition[1] - event.clientY)
      ];
      // Store for later
      this.dragPosition = [event.clientX, event.clientY];
    },
    escCloseListener(event) {
      if (event.key == 'Escape') {
        this.close();
        event.preventDefault();
        event.stopPropagation();
        return false;
      }
    },
    backgroundClose(event) {
      if (event.target === this.$el) {
        this.close();
      }
    }
  }
};
</script>

<style lang="scss">
.modal {
  position: fixed;
  z-index: 1000; /* Snotify has 9999 and is intentionally above the modals */
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: center;
  align-items: center;

  .modal-container {
    background-color: #fff;
    border: 1px solid #fff;
    min-height: 50vh;
    min-width: 300px;
    width: 70%;
    max-height: 96%;
    max-width: 96%;
    display: flex;
    flex-direction: column;
    box-shadow: 8px 8px 8px 0px rgba(0, 0, 0, 0.3);
    resize: both;
    overflow: hidden;

    &.smooth {
      transition-timing-function: linear;
      transition-property: width, height;
      transition-duration: 0.5s;
    }
  }

  .modal-header {
    background-color: #555;
    color: white;
    margin: 0;
    height: 1.5rem;
    padding: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: move;

    h2 {
      display: inline-block;
      margin: 0;
      margin-left: -0.5rem;
      padding: 0.5rem;
      font-size: 1.5rem;
      border: 0;
      cursor: text;
      text-overflow: ellipsis;
      overflow: hidden;
    }
  }

  .modal-content {
    padding: 1rem;
    overflow: auto;
    flex-grow: 1;
  }

  .inline .modal-content {
    padding: 0;
  }

  .modal-footer {
    background-color: #eee;
    margin: 0;
    padding: 1rem;
    text-align: right;

    &:empty {
      display: none;
    }
  }

  .close {
    font-size: 1.5rem;
    height: 2rem;
    width: 2rem;
    color: white;
    cursor: pointer;
    display: flex;
    justify-content: center;
    align-items: center;

    &:hover,
    &:focus {
      color: red;
    }
  }
}
</style>
