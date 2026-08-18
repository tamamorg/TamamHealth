"use client";

/**
 * A <Link> that also works when it points into the page you are already on.
 * Everything else about it is next/link — cross-page navigation, prefetching
 * and the router's own anchor scrolling are untouched.
 *
 * Used by the header (menu, search panel) and the footer, whose columns all
 * carry section links like /platform#how-it-works. See lib/hash-nav.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hashTargetOnPage, scrollToHash } from "@/lib/hash-nav";

type HashLinkProps = React.ComponentProps<typeof Link> & { href: string };

export default function HashLink({ href, onClick, children, ...rest }: HashLinkProps) {
  const pathname = usePathname();

  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        const hash = hashTargetOnPage(href, pathname);
        // Only take the click if the section is actually here; otherwise let
        // the router handle it, which covers a section rendered further down a
        // route that has not mounted yet.
        if (hash && scrollToHash(hash)) e.preventDefault();
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
