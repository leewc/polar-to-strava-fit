import { mount } from 'svelte'
import './app.css'
// Apply the saved theme BEFORE the Svelte mount so the initial paint already
// has the right .dark class on <html>. The module performs a one-shot side
// effect on import that reads localStorage + matchMedia and toggles the class.
// Importing it here (rather than inside App.svelte's <script>) avoids a flash
// of light theme on dark-preferring systems while Svelte is still hydrating.
import './lib/theme'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
