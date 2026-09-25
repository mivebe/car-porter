import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { App } from './app';

describe('App shell', () => {
  beforeEach(async () => {
    await act(() => i18n.changeLanguage('en'));
    document.documentElement.classList.remove('dark');
  });

  it('renders navigation and the search page by default', () => {
    render(<App initialPath="/" />);
    expect(screen.getByRole('link', { name: /search/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /tracking/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Search lots' })).toBeInTheDocument();
  });

  it('navigates between pages', async () => {
    const user = userEvent.setup();
    render(<App initialPath="/" />);
    await user.click(screen.getByRole('link', { name: /settings/i }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('defaults to dark theme and toggles to light (persisted)', async () => {
    const user = userEvent.setup();
    render(<App initialPath="/" />);
    expect(document.documentElement).toHaveClass('dark');
    await user.click(screen.getByRole('button', { name: 'Toggle light/dark mode' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('car-porter.theme')).toBe('light');
  });

  it('switches language to Bulgarian', async () => {
    const user = userEvent.setup();
    render(<App initialPath="/" />);
    await user.click(screen.getByRole('button', { name: 'Language' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Български' }));
    expect(await screen.findByRole('heading', { name: 'Търсене на лотове' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('bg');
    expect(localStorage.getItem('car-porter.language')).toBe('bg');
  });
});
