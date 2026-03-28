## Accessibility Manual Test Checklist

- Navigate the main auth flow (`/login` -> `/verify-otp` -> dashboard) using only keyboard (`Tab`, `Shift+Tab`, `Enter`, `Space`).
- On `/signup`, verify account type selection can be changed with keyboard and the selected option is announced as selected.
- Verify all form inputs in login/signup/forgot-password have visible text labels and can be focused in order.
- Verify icon-only controls (mobile menu toggle, password visibility toggles) announce meaningful names in a screen reader.
- Confirm focus indicator is always visible on links, buttons, inputs, tabs, and custom interactive elements.
- Open the mobile menu from keyboard, move through links, and close it again without using a pointer.
