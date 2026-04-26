import Editor from '@/pages/Editor'

// Single-page app: the editor owns the entire viewport. If we ever
// add separate routes (e.g. /projects, /runs/:id) introduce a router
// here.
export default function App() {
  return <Editor />
}
