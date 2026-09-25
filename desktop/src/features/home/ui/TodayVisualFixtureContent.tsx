import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  Sparkle,
} from "lucide-react";
import type * as React from "react";
import type { HomeFeedVisualFixture } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";

function ReviewArtwork({
  artTitle,
  footer,
  title,
  variant,
}: {
  artTitle?: string;
  footer?: string;
  title: string;
  variant: "olive" | "cedar";
}) {
  return (
    <span aria-hidden="true" className="r17-today-art-frame">
      <span className={`r17-today-art r17-today-art-${variant}`}>
        <span className="r17-today-art-brand">
          {variant === "olive" ? "The Olive House" : "Cedar Café"}
        </span>
        <span aria-hidden="true" className="r17-today-art-orb" />
        <strong>{artTitle ?? title}</strong>
        {footer ? (
          <span className="r17-today-art-footer">
            <span>{footer}</span>
            <span>01</span>
          </span>
        ) : null}
      </span>
    </span>
  );
}

function formatTodayDate() {
  const date = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return date.replace(/^(\p{L}+),?\s/u, "$1, ");
}

function ReviewMark({
  variant,
}: {
  variant: Exclude<
    HomeFeedVisualFixture["businessReviews"][number]["variant"],
    "olive" | "cedar"
  >;
}) {
  if (variant === "instagram") {
    return (
      <span
        aria-hidden="true"
        className="r17-today-mark r17-today-mark-instagram"
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
          <rect
            height="18"
            rx="5"
            stroke="currentColor"
            strokeWidth="2"
            width="18"
            x="3"
            y="3"
          />
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
          <circle cx="17.5" cy="6.5" fill="currentColor" r="1.25" />
        </svg>
      </span>
    );
  }
  if (variant === "linkedin") {
    return (
      <span
        aria-hidden="true"
        className="r17-today-mark r17-today-mark-linkedin"
      >
        <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.5 3h-17C2.67 3 2 3.67 2 4.5v15c0 .83.67 1.5 1.5 1.5h17c.83 0 1.5-.67 1.5-1.5v-15c0-.83-.67-1.5-1.5-1.5ZM8 18H5V9h3v9ZM6.5 7.75a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5ZM19 18h-3v-4.35c0-1.04-.02-2.37-1.45-2.37-1.45 0-1.67 1.13-1.67 2.3V18h-3V9h2.88v1.23h.04c.4-.71 1.38-1.45 2.84-1.45 3.03 0 3.59 1.99 3.59 4.57V18Z" />
        </svg>
      </span>
    );
  }
  if (variant === "access") {
    return (
      <span aria-hidden="true" className="r17-today-mark r17-today-mark-access">
        <AlertTriangle />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="r17-today-mark r17-today-mark-enquiry">
      <BriefcaseBusiness />
    </span>
  );
}

function BusinessReviewRow({
  review,
}: {
  review: HomeFeedVisualFixture["businessReviews"][number];
}) {
  return (
    <article
      className={`r17-today-review-row ${
        review.variant === "olive" || review.variant === "cedar"
          ? "r17-today-review-row-art"
          : "r17-today-review-row-compact"
      }`}
    >
      {review.variant === "olive" || review.variant === "cedar" ? (
        <ReviewArtwork
          artTitle={review.artTitle}
          footer={review.footer}
          title={review.title}
          variant={review.variant}
        />
      ) : (
        <ReviewMark variant={review.variant} />
      )}
      <div className="r17-today-review-copy">
        <small>{review.meta}</small>
        <strong>{review.title}</strong>
      </div>
      <ChevronRight aria-hidden="true" className="r17-today-row-chevron" />
    </article>
  );
}

function AttentionRow({
  item,
}: {
  item: HomeFeedVisualFixture["agentWork"][number];
}) {
  return (
    <article className="r17-today-attention-row">
      <span aria-hidden="true" className="r17-today-attention-icon">
        <Sparkle />
      </span>
      <span className="r17-today-attention-copy">
        <strong>
          {item.agent} · {item.title}
        </strong>
        <small>{item.detail}</small>
      </span>
      <span className={`r17-today-status r17-today-status-${item.status}`}>
        {item.status}
      </span>
      <ChevronRight aria-hidden="true" className="r17-today-row-chevron" />
    </article>
  );
}

function RightSection({
  children,
  link,
  title,
}: {
  children: React.ReactNode;
  link?: string;
  title: string;
}) {
  return (
    <section className="r17-today-section">
      <header className="r17-today-section-heading">
        <h2>{title}</h2>
        {link ? <span>{link}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function TodayVisualFixtureContent({
  fixture,
  onOpenUpdates,
}: {
  fixture: HomeFeedVisualFixture;
  onOpenUpdates: () => void;
}) {
  return (
    <main className="r17-today-page">
      <div className="r17-today-heading">
        <div>
          <h1 className="text-studio-title">Today</h1>
          <p className="text-workspace-date">{formatTodayDate()}</p>
        </div>
        <Button
          className="r17-today-updates-button"
          onClick={onOpenUpdates}
          size="sm"
          type="button"
          variant="outline"
        >
          Team updates
        </Button>
      </div>

      <div className="r17-today-grid">
        <section aria-label="Needs your attention" className="r17-today-left">
          {fixture.agentWork.map((item) => (
            <AttentionRow item={item} key={item.id} />
          ))}
          <header className="r17-today-business-heading">
            <h2>Business reviews</h2>
            <span>{fixture.businessReviews.length}</span>
          </header>
          {fixture.reviewsEmpty ? (
            <div className="r17-today-reviews-empty" role="status">
              <span aria-hidden="true">
                <Check />
              </span>
              <h3>No business reviews waiting.</h3>
              <p>
                When your team submits work for your review, it will appear
                here.
              </p>
              <span className="r17-today-view-work">
                View work <ArrowRight aria-hidden="true" />
              </span>
            </div>
          ) : (
            fixture.businessReviews.map((review) => (
              <BusinessReviewRow key={review.id} review={review} />
            ))
          )}
        </section>

        <aside aria-label="Agency activity" className="r17-today-right">
          <RightSection link="All approvals" title="With your clients">
            <article className="r17-today-waiting-record">
              <strong>{fixture.clientApproval.client}</strong>
              <p>{fixture.clientApproval.title}</p>
              <small>
                Awaiting {fixture.clientApproval.approver} · v
                {fixture.clientApproval.version}
              </small>
            </article>
          </RightSection>
          <RightSection link="Queue" title="Next delivery">
            <article className="r17-today-waiting-record">
              <strong>{fixture.nextDelivery.title}</strong>
              <small>{fixture.nextDelivery.detail}</small>
            </article>
          </RightSection>
          <RightSection title="Money to follow up">
            <article className="r17-today-money-record">
              <span>
                {fixture.moneyFollowUp.client}
                <small>
                  {fixture.moneyFollowUp.invoice} · due{" "}
                  {fixture.moneyFollowUp.due}
                </small>
              </span>
              <strong>{fixture.moneyFollowUp.amount}</strong>
            </article>
          </RightSection>
        </aside>
      </div>
    </main>
  );
}
