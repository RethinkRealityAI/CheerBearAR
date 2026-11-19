import { useId, type ReactNode } from 'react';

interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons on the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
}

/** A page of the admin panel: h1-level title (the panel's own h1 is visually hidden), description, then groups. */
export function Section({ title, description, actions, children }: SectionProps) {
  const id = useId();
  return (
    <section className="adm-section" aria-labelledby={id}>
      <header className="adm-section-head">
        <div>
          <h2 id={id} className="adm-section-title" tabIndex={-1} data-section-title>{title}</h2>
          {description && <p className="adm-section-desc">{description}</p>}
        </div>
        {actions && <div className="adm-section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

interface GroupProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  tone?: 'default' | 'danger';
  className?: string;
}

/** A card of related settings inside a section. */
export function Group({ title, description, actions, children, tone = 'default', className }: GroupProps) {
  const id = useId();
  return (
    <div className={`adm-group${tone === 'danger' ? ' danger' : ''}${className ? ` ${className}` : ''}`} role="group" aria-labelledby={title ? id : undefined}>
      {(title || actions) && (
        <div className="adm-group-head">
          <div>
            {title && <h3 id={id} className="adm-group-title">{title}</h3>}
            {description && <p className="adm-group-desc">{description}</p>}
          </div>
          {actions && <div className="adm-group-actions">{actions}</div>}
        </div>
      )}
      <div className="adm-group-body">{children}</div>
    </div>
  );
}
