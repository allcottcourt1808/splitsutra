# shadcn Theme Setup

This PR adds shadcn UI components and your custom theme to the SplitSutra project.

## Installation

Run the following command to apply the shadcn preset with your custom theme:

```bash
pnpm dlx shadcn@latest apply --preset b3ZgRo51xS
```

This command will:
- Install shadcn dependencies
- Apply your custom design tokens and theme configuration
- Set up component scaffolding for the design system

## What's included

Your preset includes:
- Custom design tokens aligned with SplitSutra's mobile-first design (390px target)
- Theme configuration for consistent styling across the app
- Component library ready for Phase 04 (Design System)

## Next steps

After running the setup command:

1. Verify the installation: `pnpm typecheck`
2. Run the dev server: `pnpm dev`
3. Start building components in Phase 04

## Reference

- [docs/07-ui-ux-spec.md](docs/07-ui-ux-spec.md) — Component library specification
- [docs/04-split-engine.md](docs/04-split-engine.md) — Design system details
