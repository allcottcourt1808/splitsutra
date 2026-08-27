/**
 * <Text> — every string in this app is rendered through it.
 *
 * React Native has no concept of a bare string inside a `<View>`: all text must sit in
 * a `<Text>`. Writing web screens the same way (docs/11 §Mapping web to native) means a
 * screen body ports without restructuring.
 *
 * Colour is chosen by TONE, never by a raw colour value, and every tone resolves to a
 * `*Text` token that is >= 4.5:1 against both light surfaces.
 */

import type { ElementType, ReactNode } from 'react';
import styles from './text.module.css';
import { cx } from './tokenProps';

export type TextVariant = 'display' | 'title' | 'body' | 'caption' | 'amount';

export type TextTone =
  | 'default'
  | 'secondary'
  | 'primary'
  | 'danger'
  | 'inverse'
  | 'onPrimary'
  /* Money direction only — never for generic success/warning states. */
  | 'positive'
  | 'negative'
  | 'neutral';

export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

const VARIANT: Readonly<Record<TextVariant, string>> = {
  display: styles.display ?? '',
  title: styles.title ?? '',
  body: styles.body ?? '',
  caption: styles.caption ?? '',
  amount: styles.amount ?? '',
};

const TONE: Readonly<Record<TextTone, string>> = {
  default: styles.toneDefault ?? '',
  secondary: styles.toneSecondary ?? '',
  primary: styles.tonePrimary ?? '',
  danger: styles.toneDanger ?? '',
  inverse: styles.toneInverse ?? '',
  onPrimary: styles.toneOnPrimary ?? '',
  positive: styles.tonePositive ?? '',
  negative: styles.toneNegative ?? '',
  neutral: styles.toneNeutral ?? '',
};

const WEIGHT: Readonly<Record<TextWeight, string>> = {
  regular: styles.weightRegular ?? '',
  medium: styles.weightMedium ?? '',
  semibold: styles.weightSemibold ?? '',
  bold: styles.weightBold ?? '',
};

export interface TextProps {
  children: ReactNode;
  variant?: TextVariant | undefined;
  tone?: TextTone | undefined;
  weight?: TextWeight | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
  /** Single-line ellipsis. Use for names and descriptions in list rows. */
  truncate?: boolean | undefined;
  /** Two-line clamp. Use for secondary copy in cards. */
  clamp2?: boolean | undefined;
  /**
   * The element to render. Headings matter for screen-reader navigation (NFR-4), and
   * the RN version ignores this prop entirely.
   */
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'label' | 'div' | undefined;
  htmlFor?: string | undefined;
  id?: string | undefined;
  className?: string | undefined;
  'aria-hidden'?: boolean | undefined;
}

export function Text({
  children,
  variant = 'body',
  tone = 'default',
  weight,
  align,
  truncate,
  clamp2,
  as,
  htmlFor,
  id,
  className,
  ...rest
}: TextProps) {
  // `ElementType` rather than a tag union: a union of intrinsic tags forces props to be
  // valid for every member, which `htmlFor` is not.
  const resolved = as ?? (variant === 'title' || variant === 'display' ? 'h2' : 'span');
  const Tag: ElementType = resolved;

  const alignClass =
    align === 'center'
      ? styles.alignCenter
      : align === 'end'
        ? styles.alignEnd
        : align === 'start'
          ? styles.alignStart
          : undefined;

  return (
    <Tag
      id={id}
      htmlFor={resolved === 'label' ? htmlFor : undefined}
      aria-hidden={rest['aria-hidden']}
      className={cx(
        styles.text,
        VARIANT[variant],
        TONE[tone],
        weight === undefined ? undefined : WEIGHT[weight],
        alignClass,
        truncate === true && styles.truncate,
        clamp2 === true && styles.clamp2,
        className,
      )}
    >
      {children}
    </Tag>
  );
}
