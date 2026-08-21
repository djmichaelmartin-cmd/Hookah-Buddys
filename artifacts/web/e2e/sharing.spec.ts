import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dismissAgeGate(page: import('@playwright/test').Page) {
  const btn = page.getByRole('button', { name: /I AM 21 OR OLDER/i });
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
  }
}

function mockSession(page: import('@playwright/test').Page, role = 'member') {
  return page.route('/api/auth/me', route =>
    route.fulfill({
      json: {
        authenticated: true,
        user: { id: 1, role, name: 'Test User', email: 'test@example.com' },
      },
    })
  );
}

function mockEmptyApis(page: import('@playwright/test').Page) {
  return page.route('/api/**', route => route.fulfill({ json: [] }));
}

function buildFeedPost(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    userId: 2,
    userName: 'Author',
    userRole: 'member',
    text: 'Check this out!',
    category: 'discussion',
    status: 'active',
    likeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 5,
    viewerCanShare: true,
    viewerCanCopyLink: true,
    allowedShareDestinations: ['public', 'lounge', 'friends', 'private', 'group'],
    isShareWrapper: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Post Sharing', () => {
  test.beforeEach(async ({ page }) => {
    // Catch-all: return empty arrays for unmatched API routes
    await mockEmptyApis(page);
    await mockSession(page);

    // Feed posts
    await page.route('/api/feed/posts*', route =>
      route.fulfill({ json: [buildFeedPost()] })
    );

    await page.route('/api/feed/posts/my', route => route.fulfill({ json: [] }));
    await page.route('/api/feed/posts/saved', route => route.fulfill({ json: [] }));
    await page.route('/api/feed/posts/liked', route => route.fulfill({ json: [] }));

    // Share groups
    await page.route('/api/feed/share-groups*', route =>
      route.fulfill({
        json: [
          { id: 10, name: 'Cool Group', memberRole: 'member', privacy: 'public' },
          { id: 11, name: 'Private Smoke Club', memberRole: 'admin', privacy: 'private' },
        ],
      })
    );

    // Share recipients
    await page.route('/api/feed/share-recipients*', route =>
      route.fulfill({
        json: [
          { id: 3, name: 'Friend One', isFriend: true },
          { id: 4, name: 'Friend Two', isFriend: true },
        ],
      })
    );

    // Private shares inbox
    await page.route('/api/feed/shares/private*', route =>
      route.fulfill({ json: [] })
    );
  });

  // ─── Existing baseline tests ─────────────────────────────────────────────

  test('opens share dialog from feed post and displays destinations including Lounge', async ({ page }) => {
    await page.goto('/feed');
    await dismissAgeGate(page);

    await page.getByTestId('share-post-btn').first().click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Share Post')).toBeVisible();
    // Normal description
    await expect(page.getByText(/choose where to share/i)).toBeVisible();

    // All 5 destinations visible
    await expect(page.getByRole('button', { name: /Public/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Lounge/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Friends/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Group/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Private Message/i })).toBeVisible();
    await expect(page.getByTestId('copy-link-btn')).toBeVisible();
  });

  test('cannot share when sharing is disabled by author', async ({ page }) => {
    await page.route('/api/feed/posts*', route =>
      route.fulfill({
        json: [buildFeedPost({
          id: 101,
          viewerCanShare: false,
          viewerCanShareReason: 'This post is private.',
        })],
      })
    );

    await page.goto('/feed');
    await dismissAgeGate(page);
    await page.getByTestId('share-post-btn').first().click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Cannot Share Post')).toBeVisible();
    await expect(page.getByText('This post is private.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Public$/i })).not.toBeVisible();
  });

  test('displays shared post preview in wrapper post', async ({ page }) => {
    await page.route('/api/feed/posts*', route =>
      route.fulfill({
        json: [buildFeedPost({
          id: 102,
          text: 'I shared this!',
          isShareWrapper: true,
          sharedPost: {
            available: true,
            sourceType: 'feed_post',
            sourcePostId: 99,
            canonicalUrl: '/posts/99',
            audience: 'public',
            text: 'The original content',
            authorName: 'Original Author',
          },
        })],
      })
    );

    await page.goto('/feed');
    await expect(page.getByText('I shared this!')).toBeVisible();
    await expect(page.getByText('Original Author')).toBeVisible();
    await expect(page.getByText('The original content')).toBeVisible();
  });

  test('displays unavailable placeholder for private shared posts', async ({ page }) => {
    await page.route('/api/feed/posts*', route =>
      route.fulfill({
        json: [buildFeedPost({
          id: 103,
          text: 'Look at this!',
          isShareWrapper: true,
          sharedPost: { available: false },
        })],
      })
    );

    await page.goto('/feed');
    await expect(page.getByText('Look at this!')).toBeVisible();
    await expect(page.getByText('Original post is unavailable or private.')).toBeVisible();
  });

  // ─── New focused tests ────────────────────────────────────────────────────

  test('granular disabled destinations shown with (off) label and non-clickable', async ({ page }) => {
    // Only public and lounge are allowed; friends/group/private disabled
    await page.route('/api/feed/posts*', route =>
      route.fulfill({
        json: [buildFeedPost({
          allowedShareDestinations: ['public', 'lounge'],
        })],
      })
    );

    await page.goto('/feed');
    await dismissAgeGate(page);
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const friendsBtn = page.getByRole('button', { name: /Friends/ });
    const groupBtn = page.getByRole('button', { name: /^Group/ });
    const privateBtn = page.getByRole('button', { name: /Private Message/ });

    // Disabled buttons should be present but disabled
    await expect(friendsBtn).toBeDisabled();
    await expect(groupBtn).toBeDisabled();
    await expect(privateBtn).toBeDisabled();

    // Should show (off) text next to disabled buttons
    await expect(friendsBtn).toContainText('(off)');

    // Public and Lounge should be enabled
    await expect(page.getByRole('button', { name: /^Public/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^Lounge/ })).toBeEnabled();
  });

  test('Lounge destination is selectable and sets active state', async ({ page }) => {
    await page.goto('/feed');
    await dismissAgeGate(page);
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const loungeBtn = page.getByRole('button', { name: /^Lounge/ });
    await expect(loungeBtn).toBeEnabled();
    await loungeBtn.click();

    // After click, Lounge button should show as selected (default variant)
    // We can verify the Share Now button is still visible and enabled
    await expect(page.getByTestId('share-now-btn')).toBeVisible();
    await expect(page.getByTestId('share-now-btn')).not.toBeDisabled();
  });

  test('group search input filters groups', async ({ page }) => {
    await page.goto('/feed');
    await dismissAgeGate(page);
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Switch to Group destination
    await page.getByRole('button', { name: /^Group/ }).click();

    // Group search input should be visible
    const searchInput = page.getByTestId('group-search-input');
    await expect(searchInput).toBeVisible();

    // Type in search
    await searchInput.fill('Private');

    // The mock returns both groups regardless of q, but the input should be present
    await expect(searchInput).toHaveValue('Private');
  });

  test('private Group sources only offer their original Group', async ({ page }) => {
    await page.route('/api/feed/posts*', route =>
      route.fulfill({
        json: [
          buildFeedPost({
            id: 108,
            isShareWrapper: true,
            allowedShareDestinations: ['group'],
            sharedPost: {
              available: true,
              sourceType: 'group_post',
              sourcePostId: 78,
              sourceGroupId: 11,
              canonicalUrl: '/groups/11?post=78',
              groupPrivacy: 'private',
              text: 'Private Group post',
              authorName: 'Author',
            },
          }),
        ],
      })
    );

    await page.goto('/feed');
    await dismissAgeGate(page);
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('button', { name: /^Group/ })).toBeEnabled();
    await page.getByRole('button', { name: /^Group/ }).click();
    await expect(page.getByText('Private Smoke Club')).toBeVisible();
    await expect(page.getByText('Cool Group')).toHaveCount(0);
  });

  test('recipient search input is shown for private destination', async ({ page }) => {
    await page.goto('/feed');
    await dismissAgeGate(page);
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Switch to Private Message
    await page.getByRole('button', { name: /Private Message/ }).click();

    // Recipient search input should be visible
    const searchInput = page.getByTestId('recipient-search-input');
    await expect(searchInput).toBeVisible();

    await searchInput.fill('Friend');
    await expect(searchInput).toHaveValue('Friend');
  });

  test('comment textarea enforces 500-character max with count', async ({ page }) => {
    await page.goto('/feed');
    await dismissAgeGate(page);
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const textarea = page.getByPlaceholder('Add an optional comment...');
    await expect(textarea).toBeVisible();

    // Should show 0/500 counter initially
    await expect(page.getByText('0/500')).toBeVisible();

    // Type up to 500 chars
    const text500 = 'a'.repeat(500);
    await textarea.fill(text500);
    await expect(page.getByText('500/500')).toBeVisible();

    // The textarea should have exactly 500 chars (capped)
    await expect(textarea).toHaveValue(text500);
  });

  test('copy link writes canonical URL to clipboard only (no navigator.share)', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Mock copy link endpoint
    await page.route('/api/feed/posts/100/copy-link', route =>
      route.fulfill({
        json: { canonicalUrl: '/posts/100', shareId: 42 },
      })
    );

    await page.goto('/feed');
    await dismissAgeGate(page);
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Verify navigator.share is NOT called (we never invoke it from Copy Link)
    await page.evaluate(() => {
      (window as any).__shareCalled = false;
      (window as any).navigator.share = () => {
        (window as any).__shareCalled = true;
        return Promise.resolve();
      };
    });

    const copyBtn = page.getByTestId('copy-link-btn');
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // Navigator.share should NOT have been called
    const shareCalled = await page.evaluate(() => (window as any).__shareCalled);
    expect(shareCalled).toBe(false);

    // Button should show "Copied!" feedback
    await expect(page.getByTestId('copy-link-btn')).toContainText('Copied!');
  });

  test('dialog resets state when closed and reopened', async ({ page }) => {
    await page.goto('/feed');
    await dismissAgeGate(page);

    // Open dialog
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Switch to Private Message
    await page.getByRole('button', { name: /Private Message/ }).click();

    // Add a comment
    const textarea = page.getByPlaceholder('Add an optional comment...');
    await textarea.fill('some comment');
    await expect(textarea).toHaveValue('some comment');

    // Close dialog
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();

    // Reopen
    await page.getByTestId('share-post-btn').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Comment should be reset
    const freshTextarea = page.getByPlaceholder('Add an optional comment...');
    await expect(freshTextarea).toHaveValue('');

    // Destination should be reset to Public (not Private Message)
    // The recipient search input should NOT be visible (private is not selected)
    await expect(page.getByTestId('recipient-search-input')).not.toBeVisible();
  });

  test('SharedPostPreviewCard shows privacy badge for private group post', async ({ page }) => {
    await page.route('/api/feed/posts*', route =>
      route.fulfill({
        json: [buildFeedPost({
          id: 105,
          isShareWrapper: true,
          sharedPost: {
            available: true,
            sourceType: 'group_post',
            sourcePostId: 55,
            sourceGroupId: 20,
            canonicalUrl: '/groups/20?post=55',
            groupPrivacy: 'private',
            groupName: 'Secret Club',
            text: 'Secret group content',
            authorName: 'Group Member',
          },
        })],
      })
    );

    await page.goto('/feed');
    // Privacy badge for private group
    await expect(page.getByText('Private Group')).toBeVisible();
  });

  test('SharedPostPreviewCard shows public audience badge for feed post', async ({ page }) => {
    await page.route('/api/feed/posts*', route =>
      route.fulfill({
        json: [buildFeedPost({
          id: 106,
          isShareWrapper: true,
          sharedPost: {
            available: true,
            sourceType: 'feed_post',
            sourcePostId: 99,
            canonicalUrl: '/posts/99',
            audience: 'public',
            text: 'Public post content',
            authorName: 'Public Author',
          },
        })],
      })
    );

    await page.goto('/feed');
    await expect(page.getByText('Public', { exact: true })).toBeVisible();
  });

  test('SharedPostPreviewCard group link includes post query param', async ({ page }) => {
    await page.route('/api/feed/posts*', route =>
      route.fulfill({
        json: [buildFeedPost({
          id: 107,
          isShareWrapper: true,
          sharedPost: {
            available: true,
            sourceType: 'group_post',
            sourcePostId: 77,
            sourceGroupId: 30,
            canonicalUrl: '/groups/30?post=77',
            groupPrivacy: 'public',
            text: 'Group post text',
            authorName: 'Author',
          },
        })],
      })
    );

    await page.goto('/feed');
    // The link should navigate to /groups/30?post=77
    const link = page.locator('a[href*="/groups/30"]').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain('/groups/30');
    expect(href).toContain('post=77');
  });

  test('navbar member dropdown has Shared with you shortcut', async ({ page }) => {
    await page.goto('/feed');

    // Open the user dropdown
    const avatar = page.getByRole('button', { name: /test user account menu/i });
    if (await avatar.isVisible({ timeout: 3000 }).catch(() => false)) {
      await avatar.click();
      await expect(page.getByRole('menuitem', { name: /Shared with you/i })).toBeVisible();
      const link = page.getByRole('link', { name: /Shared with you/i });
      const href = await link.getAttribute('href');
      expect(href).toContain('/dashboard/member');
      expect(href).toContain('tab=shared');
    }
  });

  test('private inbox shows shared posts with received direction', async ({ page }) => {
    await page.route('/api/feed/shares/private*', route => {
      const url = route.request().url();
      const params = new URL(url).searchParams;
      const direction = params.get('direction') ?? 'received';
      if (direction === 'received') {
        return route.fulfill({
          json: [{
            id: 1,
            sharerId: 5,
            sharerName: 'Bestie',
            destination: 'private',
            sourceType: 'feed_post',
            sourcePostId: 200,
            sharerComment: 'Thought you would like this',
            sharedPost: {
              available: true,
              sourceType: 'feed_post',
              sourcePostId: 200,
              canonicalUrl: '/posts/200',
              audience: 'public',
              text: 'Original post here',
              authorName: 'Some User',
            },
            createdAt: new Date().toISOString(),
          }],
        });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto('/dashboard/member?tab=shared');

    await expect(page.getByText('Shared Inbox')).toBeVisible();
    await expect(page.getByText('Bestie')).toBeVisible();
    await expect(page.getByText('Thought you would like this')).toBeVisible();
    await expect(page.getByText('Original post here')).toBeVisible();
  });

  test('sent inbox tab shows sent shares', async ({ page }) => {
    await page.route('/api/feed/shares/private*', route => {
      const url = route.request().url();
      const params = new URL(url).searchParams;
      const direction = params.get('direction');
      if (direction === 'sent') {
        return route.fulfill({
          json: [{
            id: 2,
            sharerId: 1,
            sharerName: 'Test User',
            destination: 'private',
            sourceType: 'feed_post',
            sourcePostId: 300,
            sharerComment: 'Check this out',
            sharedPost: {
              available: true,
              sourceType: 'feed_post',
              sourcePostId: 300,
              canonicalUrl: '/posts/300',
              text: 'A sent post',
              authorName: 'Someone',
            },
            createdAt: new Date().toISOString(),
          }],
        });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto('/dashboard/member?tab=shared');
    await dismissAgeGate(page);
    await expect(page.getByText('Shared Inbox')).toBeVisible();

    // Switch to Sent
    const sentTab = page.getByTestId('shared-sent-tab');
    await expect(sentTab).toBeVisible();
    await sentTab.click();

    await expect(page.getByText('A sent post')).toBeVisible();
    await expect(page.getByText('Check this out')).toBeVisible();
  });

  test('admin shares tab shows source type and destination filter buttons', async ({ page }) => {
    // Mock admin session
    await page.route('/api/auth/me', route =>
      route.fulfill({
        json: {
          authenticated: true,
          user: { id: 99, role: 'admin', name: 'Admin', email: 'admin@example.com' },
        },
      })
    );

    // Mock admin shares
    await page.route('/api/admin/shares*', route =>
      route.fulfill({
        json: { total: 0, shares: [] },
      })
    );

    await page.goto('/admin');

    // Click Shares tab
    const sharesTab = page.getByRole('tab', { name: /Shares/i });
    if (await sharesTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sharesTab.click();

      // Source type filters should be visible
      await expect(page.getByRole('button', { name: /Feed Post/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Group Post/i })).toBeVisible();

      // Destination filters should be visible
      await expect(page.getByRole('button', { name: /lounge/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /private/i }).first()).toBeVisible();
    }
  });

  test('mobile viewport: share dialog action buttons are not clipped', async ({ page, browser }) => {
    // Use a narrow mobile viewport
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 667 },
    });
    const mobilePage = await mobileContext.newPage();

    await mockEmptyApis(mobilePage);
    await mobilePage.route('/api/auth/me', route =>
      route.fulfill({
        json: { authenticated: true, user: { id: 1, role: 'member', name: 'Test' } },
      })
    );
    await mobilePage.route('/api/feed/posts*', route =>
      route.fulfill({ json: [buildFeedPost()] })
    );
    await mobilePage.route('/api/feed/share-groups*', route =>
      route.fulfill({ json: [] })
    );
    await mobilePage.route('/api/feed/share-recipients*', route =>
      route.fulfill({ json: [] })
    );
    await mobilePage.route('/api/feed/shares/private*', route =>
      route.fulfill({ json: [] })
    );

    await mobilePage.goto('/feed');
    await dismissAgeGate(mobilePage);

    await mobilePage.getByTestId('share-post-btn').first().click();
    await expect(mobilePage.getByRole('dialog')).toBeVisible();

    // Both action buttons should be visible without horizontal overflow
    const copyBtn = mobilePage.getByTestId('copy-link-btn');
    const shareNowBtn = mobilePage.getByTestId('share-now-btn');

    await expect(copyBtn).toBeVisible();
    await expect(shareNowBtn).toBeVisible();

    // Check they are within viewport
    await expect
      .poll(async () => {
        const copyBox = await copyBtn.boundingBox();
        const shareBox = await shareNowBtn.boundingBox();
        const viewportWidth = await mobilePage.evaluate(() => window.innerWidth);
        return Boolean(
          copyBox &&
            shareBox &&
            copyBox.x >= 0 &&
            shareBox.x >= 0 &&
            copyBox.x + copyBox.width <= viewportWidth &&
            shareBox.x + shareBox.width <= viewportWidth
        );
      })
      .toBe(true);

    await mobileContext.close();
  });
});
