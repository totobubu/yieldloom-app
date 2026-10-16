---
name: primevue4-ui
description: Vue 3 + PrimeVue 4 기반의 UI 개발,
  퍼블리싱, 테마 커스터마이징 및 컴포넌트 재사용
  작업에 사용한다.
---

# PrimeVue 4 UI Development

## Technology
- Vue 3
- PrimeVue 4.x
- Composition API
- SCSS
- Storybook

## Documentation
- https://v4.primevue.org/
- Always use PrimeVue 4 documentation.
- Never introduce PrimeVue 5-only APIs.
- Verify installed package versions.

## Component Rules
1. Reuse existing components first.
2. Prefer PrimeVue native components.
3. Use props, emits and slots.
4. Avoid duplicate UI implementations.
5. Maintain existing public APIs.

## Styling Priority
1. Existing project design tokens
2. PrimeVue theme preset / tokens
3. PrimeVue Pass Through API
4. Existing SCSS architecture
5. Scoped CSS overrides as last resort

## Quality
- Responsive layouts
- Keyboard accessibility
- Light and dark themes if supported
- Loading, empty, error and disabled states
- Storybook documentation
- No unrelated changes

## Validation
- Run existing lint and typecheck scripts.
- Run relevant tests.
- Report any checks not executed.

## Project Integration
- Apply alongside [vue-primevue-best-practices](../vue-primevue-best-practices/SKILL.md)
  and follow its validation table for the changed scope.
- The typecheck command is `npm run type-check`.
- `npm run lint` and the individual lint scripts include `--fix`; inspect their
  changes and avoid unrelated edits. Do not treat them as read-only checks.
- For documentation or skill-only changes, verify paths, commands and the diff;
  app lint, typecheck, tests and build are unnecessary.
- The app currently has no Storybook dependency or script. When Storybook work
  is in scope, use the installed [storybook skill](../storybook/SKILL.md).
  This skill alone does not require adding Storybook to unrelated UI changes.
