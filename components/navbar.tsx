"use client";

import React, { useState } from "react";
import { Logo } from "./logo";
import { Container } from "./container";
import { AnimatePresence, motion } from "motion/react";
import { ModeToggle } from "./mode-toggle";
import { Menu, X } from "lucide-react";

export const Navbar = () => {
  return (
    <Container as="nav">
      <DesktopNav />
      <MobileNav />
    </Container>
  );
};

const MobileNav = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative flex items-center justify-between p-2 md:hidden">
      <Logo />
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="shadow-aceternity flex size-6 flex-col items-center justify-center rounded-md"
        aria-label="Toggle menu"
      >
        <Menu className="size-4 shrink-0 text-gray-600" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex flex-col bg-white shadow-lg dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between p-2">
              <Logo />
              <button
                onClick={() => setIsOpen(false)}
                className="shadow-aceternity flex size-6 flex-col items-center justify-center rounded-md"
                aria-label="Close menu"
              >
                <X className="size-4 shrink-0 text-gray-600" />
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center">
              <ModeToggle />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DesktopNav = () => {
  return (
    <div className="hidden items-center justify-between px-4 py-4 md:flex">
      <Logo />
      <ModeToggle />
    </div>
  );
};
