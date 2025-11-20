# Verification Walkthrough - React DevTools UI

## Goal
Verify that the Shadow DOM Inspector now resembles React DevTools and correctly handles Shadow DOM traversal with the new split-pane UI.

## Prerequisites
1.  **Reload Extension:** Go to `chrome://extensions`, find "Shadow DOM Inspector", and click the **Reload** icon.
2.  **Run Demo App:**
    -   Open a terminal in `react-test-app`.
    -   Run `npm install` (if not done) and `npm run dev`.
    -   Open the Local URL (e.g., `http://localhost:5173`).
3.  **Open Test Page:** Alternatively, open `test_page.html` in a new tab.

## Verification Steps

### 1. UI Layout Check
- [ ] Open Chrome DevTools (`F12` or `Cmd+Option+I`).
- [ ] Navigate to the **"Shadow Inspect"** tab.
- [ ] **Verify:** You should see a split-pane layout:
    -   **Left:** Component Tree (Search bar at top).
    -   **Right:** Details Pane ("Props" header).
    -   **Theme:** Should be dark mode (default) or match your system theme.

### 2. Tree Traversal
- [ ] Click the **"🔄" (Scan)** button.
- [ ] **Verify:** The tree should populate with the DOM structure.
- [ ] **Verify:** Shadow Roots are clearly marked (e.g., `#shadow-root (open)`).
- [ ] **Action:** Click the `▶` arrow next to a node to expand it.
- [ ] **Verify:** Children are revealed. Check deep nesting if available.

### 3. Selection & Details
- [ ] **Action:** Click on a tag name (e.g., `<my-component>`) in the tree.
- [ ] **Verify:** The node is highlighted in blue/dark blue.
- [ ] **Verify:** The **Right Pane** updates to show the attributes of that element.
    -   Check `id`, `class`, and other custom attributes.
- [ ] **Action:** Click on `#shadow-root`.
- [ ] **Verify:** The right pane shows the shadow root `mode`.

### 4. Search (Basic)
- [ ] **Action:** Type a tag name (e.g., `div` or `my-component`) in the search bar.
- [ ] **Verify:** The tree re-renders. (Note: Current MVP implementation might just filter the view or highlight; verify behavior matches expectation).

## Troubleshooting
-   If the tree is empty, try clicking "Scan" again.
-   If "Error" is displayed, check the Console in the DevTools window itself (undock DevTools -> Cmd+Option+I on the DevTools window) for errors in `panel.js`.
