<template>
  <BaseModal width="50%" title="About">
    <p>A simple Geoparquet Viewer for the Web.</p>
    <ul>
      <li><a href="https://github.com/m-mohr/geoparquet-viewer">Check the code</a></li>
      <li>
        <a href="https://github.com/m-mohr/geoparquet-viewer/issues">
          Submit bug reports and enhancement proposals
        </a>
      </li>
    </ul>
    <p>
      This project was implemented and is maintained by
      <a href="https://moregeo.it" target="_blank">moreGeo</a>
      with initial funding from <a href="https://ogc.org" target="_blank">OGC</a>.
    </p>
    <p>This project is built on top of:</p>
    <ul>
      <li><a href="https://vuejs.org" target="_blank">Vue</a></li>
      <li><a href="https://openlayers.org" target="_blank">OpenLayers</a></li>
      <li><a href="https://github.com/hyparam/hyparquet" target="_blank">hyparquet</a></li>
    </ul>
    <p>
      The project is generously hosted by <a href="https://github.com" target="_blank">GitHub</a>.
    </p>
  </BaseModal>
</template>

<script>
import BaseModal from './BaseModal.vue';

export default {
  name: 'AboutModal',
  components: {
    BaseModal
  }
};
</script>
