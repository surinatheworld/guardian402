"use client";
// A small form in a modal: the owner enters values, then "Xem lại" hands over to the review-and-sign dialog.
import { Button } from "@heroui/react/button";
import { Modal } from "@heroui/react/modal";
import type { ReactNode } from "react";

export function EditModal({
  isOpen,
  onOpenChange,
  title,
  children,
  submitLabel = "Xem lại",
  isSubmitDisabled = false,
  onSubmit,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  submitLabel?: string;
  isSubmitDisabled?: boolean;
  onSubmit: () => void;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-md">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading className="text-lg font-semibold">{title}</Modal.Heading>
          </Modal.Header>
          <form
            className="contents"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isSubmitDisabled) onSubmit();
            }}
          >
            <Modal.Body className="flex flex-col gap-4">{children}</Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="tertiary">
                Huỷ
              </Button>
              <Button type="submit" isDisabled={isSubmitDisabled}>
                {submitLabel}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
