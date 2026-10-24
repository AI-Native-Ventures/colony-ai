import "./welcome.css";

type WelcomePostcardProps = {
  businessName: string;
  /** "today", or a date such as "23 Oct 2026". */
  founded: string;
  founderName?: string;
};

/**
 * The postcard at the top of a business's first channel (`Main.dc.html`): a
 * doorway in soft hills under a morning sun, with the business name above it.
 * The artwork is the same for every business.
 */
export function WelcomePostcard({
  businessName,
  founded,
  founderName,
}: WelcomePostcardProps) {
  return (
    <figure className="cw-postcard" data-testid="welcome-postcard">
      <div className="cw-postcard-art">
        <svg
          aria-label={`Postcard of ${businessName}: a doorway in soft hills under a morning sun`}
          height="168"
          role="img"
          viewBox="0 0 300 168"
          width="300"
        >
          <circle cx="232" cy="46" fill="#FFE7A6" r="18" />
          <path
            d="M0 132 C 50 96, 100 98, 150 70 C 200 98, 250 96, 300 120 L 300 168 L 0 168 Z"
            fill="#EFD8E8"
          />
          <path
            d="M0 146 C 70 126, 130 128, 180 116 C 230 130, 270 132, 300 140 L 300 168 L 0 168 Z"
            fill="#F7E3D6"
          />
          <path d="M136 112 v-22 a14 14 0 0 1 28 0 v22 z" fill="#5B45BE" />
        </svg>
        <span className="cw-postcard-name">{businessName}</span>
      </div>
      <figcaption>
        Founded {founded}
        {founderName ? <span> by {founderName}</span> : null}
      </figcaption>
    </figure>
  );
}
