# Daily Paper

An interface for viewing a daily issue of the Guardian and Observer newspapers.  
Using the [Guardian Open Platform](http://www.guardian.co.uk/open-platform).  
As used at [Today's Guardian](http://guardian.gyford.com/).


## Introduction

This code consists of two main things:

* A Python script which fetches the day's newspaper content from the Open Platform
  and saves each article as a separate HTML file locally.
* An index.html file which uses JavaScript and CSS to display those HTML files.

The Python script should be run at least once per day, with the Guardian/Observer's
daily content rolling over roughly around midnight, UK time. The list of content
continues to change, so it's worth having the script run every hour or so for a
while (but not all day, or you'll hit daily API limits). Running the script 
subsequent times in a day will update/replace any existing files.

Only one day's worth of content is saved at a time, with older days being deleted 
(the API only allows for you to keep content for 24 hours). Each day's content is
stored in a dated directory within the archive/ directory.


## Requirements

The Python script for fetching the papers' content requires:

* [Beautiful Soup](http://www.crummy.com/software/BeautifulSoup/).
* [Requests](http://docs.python-requests.org/en/latest/)
* [Smartypants](http://web.chad.org/projects/smartypants.py/)


The JavaScript requires [jQuery](http://jquery.com/) and a copy is
automatically included from [Google's
Libraries API](http://code.google.com/apis/libraries/).


## Issues

There are various known issues/enhancements/proposals listed on the project's
[Issues page](https://github.com/philgyford/daily-paper/issues).

The site should work fine in most desktop web browsers, and not too bad on 
iPhone/iPad/iPod Touch. I've never used it on an Android device.


## Installation

1. [Get an API key](http://guardian.mashery.com/) for the Guardian Open
   Platform.

2. Install the BeautifulSoup, Requests and Smartypants Python libraries. It's 
   easiest to use [pip](https://pip.pypa.io/en/latest/) and do
   `pip install -r requirements.txt` in your shell.

3. Make the daily-paper/public/ directory readable from the web. You can move
   it elsewhere without breaking the Python script, although I guess that will
   confuse Git. Or you could symlink it to somewhere appropriate.

4. Copy daily-paper/scripts/scraper-example.cfg to daily-paper/scripts/scraper.cfg.

5. Edit scraper.cfg and add: 

	* Your API key.
	* The path to the directory where you want the dated folders for saved HTML
	  files to be kept. This should be called 'archive' and be within the
	  project's 'public' directory, at the same level as 'index.html'.
	* If the 'verbose' setting is left to 1, you will see a list of the API
	  files fetched while the script runs. Best to leave it at 1 initially.

6. Run the daily-paper/scripts/scraper.py script. This should leave you with
   a dated directory in the archive directory you specified in the config file.
   It should contain an HTML file for every article from today's paper.

7. View public/ in your web browser. You should be able to read today's paper.






