# Changelog


## [Unreleased]

* Updated links in the About page and README.


## [v2.0.2] - 2020-06-09

* Remove broken loading of CDN version of jQuery; just use local file.


## [v2.0.1] - 2020-06-09

* Remove unused beautifulsoup requirement


## [v2.0.0] - 2020-06-09

* Now uses python 3.7 (instead of 2.7)
* Use Flake8 linting and Black formatting
* Many font sizes tweaks (consistency and making smallest text bigger)
* Fix broken scrolling
* Fix video embed sizes
* Make thumbnail images bigger


## [v1.2.8] - 2019-05-05

* Add requirements.txt back


## [v1.2.7] - 2019-05-05

* Upgrade python dependencies; improve exception handling


## [v1.2.6] - 2018-03-28

* Fix CSS for different kinds of embedded elements


## [v1.2.5] - 2018-03-27

* Fix CSS for embeds


## [v1.2.4] - 2017-03-28

(v.1.2.3 appears to be the same)

* Fix 'v' keyboard command


## [v1.2.2] - 2016-10-10

* Moving left/right wasn't working in Safari or Chrome on iOS 10. Now it is.


## [v1.2.1] - 2016-06-18

Layout and swiping fixes

* Stop photo caption credits breaking onto multiple lines.
* On iOS (and probably other touch devices) fix the ability to swipe left/right when you're scrolled down the page
* Fix embedded videos. They should now be more responsive, and fit on one page, not overlapping other articles.


## [v1.2] - 2015-12-21

Use API (not page scraping), Jinja templates, upgraded JS libraries, and more.

* No more page scraping; everything is done through the API.
* Fetch all articles in one (or maybe two) queries, instead of individual queries.
* Using Jinja2 for templating.
* Using typogrify for text niceties.
* Showing byline photos for Opinion articles that have byline photos.
* Making the colours of headings consistent with the current Guardian site's tone colours.
* Upgrade jQuery and various JavaScript plugins/libraries.
* Change to HTML5.
* Start using semantic versioning.


## [v1.12] - 2011-07-11

* Mainly iPhone fixes.


## [v1.111] - 2011-06-17

* Fixed 'see original' link for mobile devices.


## [v1.11] - 2011-06-17

* Fix for width of articles on iPhone.


## [v1.1] - 2011-06-16

Various improvements, particularly for iOS devices.

* On iPad, added clickable next/prev areas.
* On iPad, the swipable area for short articles extends to fill the empty page.
* On iPad, small text made slightly larger.
* On iPhone, most text made smaller.
* Sparkline navigation will shrink in width if it would otherwise wrap to another row.
* "See original" links on stories with no reproduction rights link to print versions.


## [v1.0]

Initial release