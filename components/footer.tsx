import { Container } from "./container";

export const Footer = () => {
  return (
    <Container>
      <div className="my-4 flex items-center justify-center px-4 pt-6">
        <p className="text-footer-link text-sm">
          &copy; 2026 Ruya Hacks. Built at RuyaHacks Hackathon.
        </p>
      </div>
    </Container>
  );
};
