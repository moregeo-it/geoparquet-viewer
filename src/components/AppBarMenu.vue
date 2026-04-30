<!-- AppBarMenu.vue -->
<template>
  <!-- Desktop: buttons + dropdown menus -->
  <template v-if="!isMobile">
    <template v-for="(group, gi) in menuGroups" :key="gi">
      <v-divider vertical class="ma-2" />
      <template v-for="item in group.items" :key="item.title">
        <!-- Item with children → v-menu dropdown -->
        <v-menu v-if="item.children">
          <template #activator="{ props }">
            <v-btn size="small" v-bind="props" append-icon="mdi-chevron-down">
              {{ item.title }}
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              v-for="child in item.children"
              :key="child.title"
              :title="child.title"
              @click="child.action"
            />
          </v-list>
        </v-menu>
        <!-- Plain button -->
        <v-btn
          v-else
          size="small"
          :href="item.href"
          :target="item.href ? '_blank' : undefined"
          @click="item.action?.()"
        >
          {{ item.title }}
        </v-btn>
      </template>
    </template>
  </template>

  <!-- Mobile: single hamburger -->
  <v-menu v-else v-model="open" :close-on-content-click="false">
    <template #activator="{ props }">
      <v-app-bar-nav-icon v-bind="props" />
    </template>
    <v-list density="compact">
      <template v-for="(group, gi) in menuGroups" :key="gi">
        <v-divider v-if="gi > 0" class="my-1" />
        <template v-for="item in group.items" :key="item.title">
          <!-- Item with children → v-list-group -->
          <v-list-group v-if="item.children" :value="item.title">
            <template #activator="{ props }">
              <v-list-item v-bind="props" :title="item.title" />
            </template>
            <v-list-item
              v-for="child in item.children"
              :key="child.title"
              :title="child.title"
              class="pl-6"
              @click="
                child.action();
                open = false;
              "
            />
          </v-list-group>
          <!-- Plain item -->
          <v-list-item
            v-else
            :title="item.title"
            :href="item.href"
            :target="item.href ? '_blank' : undefined"
            @click="item.action && (item.action(), (open = false))"
          />
        </template>
      </template>
    </v-list>
  </v-menu>
</template>

<script>
export default {
  props: {
    menuGroups: { type: Array, required: true },
    isMobile: { type: Boolean, default: false }
  },
  data() {
    return { open: false };
  }
};
</script>
