#!/usr/bin/env python
# -*- coding: utf-8 -*-
import ConfigParser
import datetime
import dateutil.parser
import fcntl
import json
import os
import re
import requests
import shutil
import signal
import smartypants
import sys
import time
import urlparse
import warnings
from bs4 import BeautifulSoup


class GuardianGrabber:

    def __init__(self):

        self.load_config()
        
        
    def load_config(self):
        "Sets initial object variables, and loads others from the scraper.cfg file"
        
        # First, variables which are set here, not in the config file.
        
        # The array we'll store all the data about today's issue, in this format:
        #
        # {
        #     'meta': {
        #         'max_words': 2340,
        #         'paper_name': 'observer'
        #     },
        #     'books': [
        #         {
        #             'meta': {
        #                   'id': '',
        #                   'webUrl': 'http...',
        #                   'webTitle':'Main section',
        #                   ...},
        #             'articles': [{
        #                   'id': 'world/gallery/2010/jul/07/spain-spain',
        #                   'path': '/world/gallery/2010/jul/07/spain-spain',
        #                   'title': 'Article title...',
        #                   'file': 'spain-spain.html',
        #                   'words': 374,
        #                   'newspaperPageNumber': 34,
        #                   'newspaperBookSection': {'id':'','title':'', ...}
        #               }, {}, {}]
        #         },
        #         {}
        #     ]
        # }
        self.contents = {
            'meta': {
                'max_words': 0
            },
            'books': []
        }

        # Temporary place for what will go in self.contents['books'].
        # In this case it's structured like:
        # {
        #   'theguardian/sport': {
        #       'meta': {...},
        #       'articles': [{...}, {...}, ...],
        #   },
        #   ...
        # }
        #
        # Then, after fetching we'll put all the values from this into
        # self.contents['books'] in the correct order.
        self.fetched_books = {}
        
        # This will be set in get_list_of_articles() depending on what issue we're 
        # etching. A datetime object.
        self.issue_date = None
        
        # Will be set in start() to a path of self.archive_dir plus self.issue_date
        self.issue_archive_dir = ''
        
        # The URLs of the full list of the current issue of the Guardian and
        # Observer.
        self.source_urls = {
            'guardian': 'http://www.theguardian.com/theguardian',
            'observer': 'http://www.theguardian.com/theobserver',
        }
        
        # When we've worked out what date we're on, this will be either 'guardian'
        # or 'observer'.
        self.paper_name = ''
        
        # The 'books' are like 'Main section' or 'The Guide'.
        self.books = {}

        # 'book_sections' are like 'Film & music reviews' or 'Financial'.
        self.book_sections = {}

        # Will be the lockfile we check to make sure this script doesn't run
        # multiple times.
        self.lockfile_path = sys.path[0]+'/lock.pid'
        
        # Second, load stuff from the config file.
        
        config_file = sys.path[0]+'/scraper.cfg'
        config = ConfigParser.SafeConfigParser()
        
        try:
            config.readfp(open(config_file))
        except IOError:
            raise ScraperError("Can't read config file: " + config_file)

        self.guardian_api_key = config.get('Settings', 'guardian_api_key')
        
        self.archive_dir = config.get('Settings', 'archive_dir')
        
        self.verbose = config.getboolean('Settings', 'verbose')
        
    def checkForOldProcesses(self):
        """
        Checks the lockfile to see if there's an older process running.
        If so, tries to kill it and deletes the lockfile.
        """
        if os.access(self.lockfile_path, os.F_OK):
            # If the file is there, check the PID number.
            lockfile = open(self.lockfile_path, 'r')
            lockfile.seek(0)
            old_pid = lockfile.readline()
            if old_pid:
                try:
                    # Doesn't kill it, but checks to see if the pid exists.
                    os.kill(int(old_pid), 0)
                    try:
                        os.kill(int(old_pid), signal.SIGQUIT)
                        self.removeLockfile
                        warnings.warn("Lockfile found ("+self.lockfile_path+"). An instance of this program was already running as process "+old_pid+" but it was killed. Continuing")
                    except OSError:
                        # Couldn't kill it. Quit.
                        raise ScraperError("Lockfile found (%s).\nAn instance of this program is already running as process %s but it could not be killed.\nExiting." % (self.lockfile_path, old_pid))
                except OSError:
                    # Process not running. Just delete file.
                    self.removeLockfile
            else:
                warnings.warn("Lockfile found ("+self.lockfile_path+") but it did not contain a PID. Deleting it and continuing.")

    def makeLockfile(self):
        """
        Create a file to show this script is running.
        """
        lockfile = open(self.lockfile_path, 'w')
        lockfile.write("%s" % os.getpid())
        lockfile.close()

    def removeLockfile(self):
        os.remove(self.lockfile_path)
        
    def start(self):
        """
        The main action. Fetches all of the required data for today's paper and
        saves it locally.
        """

        self.checkForOldProcesses()
        self.makeLockfile()
        
        # Sets the date and paper (guardian or observer).
        self.set_issue_date()
        
        if self.issue_date != '':
            self.issue_archive_dir = self.archive_dir + self.issue_date.strftime("%Y-%m-%d") + '/'
        else:
            raise ScraperError("We don't have an issue date, so can't make an archive directory.")
        
        # Make the directory we'll save the HTML files in.
        if not os.path.exists(self.issue_archive_dir):
            os.makedirs(self.issue_archive_dir)
        
        # Get all of today's articles and save HTML versions to disk.
        self.fetch_articles()

        self.sort_articles()
         
        # Delete the day-before-yesterday's files.
        # (Not yesterday's, just in case someone is currently viewing them.)
        old_date = self.issue_date - datetime.timedelta(2)
        old_dir = self.archive_dir + old_date.strftime("%Y-%m-%d")
        if os.path.exists(old_dir):
            shutil.rmtree(old_dir)
 
        # Write all the information about this issue to a contents.json file within
        # the dated folder.
        try:
            with open(self.issue_archive_dir + 'contents.json', mode='w') as fp:
                json.dump(self.contents, fp)
        except EnvironmentError:
            raise ScraperError("Unable to write the contents.json file.")

        self.removeLockfile()
        

    #def get_list_of_articles(self):
        #"""
        #Fetches all the information today's paper, including section names and
        #the list of links for every article within each section.
        #"""
        
        #soup = self.find_todays_content()
        
        ## Get each of the section headings (eg, 'Main section', 'Sport', 'G2').
        #sections = soup.findAll('section')
        
        #for section in sections:
            ## Get the section title and link.
            #title = section.find('div', {'class': 'fc-container__header__title'})
            #try:
                #section_url = title.find('a').get('href')
                #section_title = title.find('a').string
            #except AttributeError:
                ## 'front page' has no <a> or link:
                #section_url = ''
                #section_title = title.find('span').string

            ## Set up the structure in which we'll store info about this section.
            #new_section = {
                #'meta': {
                    #'webUrl': section_url,
                    #'webTitle': section_title.strip()
                #}, 
                #'articles':[]
            #}
            
            ## Get all the links for this section, and add to new_section['articles]
            #article_links = section.findNext('ul', {'class': 'fc-slice'}).findAll('a', {'class': 'fc-item__link'})
            #for a in article_links:
                #article_url = a.get('href', '')
                ## We just store the absolute path, not the full URL.
                #o = urlparse.urlparse(article_url)
                #new_section['articles'].append({
                    #'path': o.path,
                    ## We also store the title here, rather than use the one from the
                    ## API, in case we fail to fetch the page from the API - we'll
                    ## still want to display the title in the article's page.
                    #'title': a.get_text().strip()
                #})
            
            ## Add this section to the contents.
            #self.contents['sections'].append(new_section)


        ## TODO: REMOVE THIS
        ## Because the page we scrape splits stuff into lots of little
        ## sections, we're going to smush it all together into one big
        ## 'Main section' section here:

        ## Get the current sections:
        #sections = self.contents['sections']

        ## Remake the array:
        #self.contents['sections'] = [
            #{
                #'meta': {
                    #'webUrl': '',
                    #'webTitle': 'Main section'
                #}, 
                #'articles':[]
            #}
        #]
        ## Recreate it:
        #for section in sections:
            #for link in section['articles']:
                #self.contents['sections'][0]['articles'].append(link)
    
    
    def set_issue_date(self):
        """
        Works out what date's paper we're getting.
        Sets self.issue_date and self.paper_name.
        """
        # Close enough to UK time. Can't work out how to get GMT/BST appropriately.
        date_today = datetime.datetime.utcnow()
        
        # Get the page of paper contents correct for this day, and put the HTML into
        # Beautiful Soup.
        soup = BeautifulSoup( self.fetch_page( self.paper_url(date_today) ), 'html.parser')
        
        # Scrape the page for the date printed on it and compare that to today's
        # date.
        date_diff = date_today - self.scrape_print_date(soup)
        
        # What's the difference between the dates?.
        # If it's one day out, that's fine - could be that it's currently
        # just past midnight and yesterday's Guardian is still up.
        # But if it's more than one day, it could be that it's just past midnight on
        # Monday and we've fetched the Guardian's current contents but it's
        # Saturday's. So we need to try again, and fetch Sunday's Observer instead.
        if date_diff.days > 1:

            date_yesterday = date_today - datetime.timedelta(1)
            self.message('Setting issue date: Difference is more than one day.')
            self.message("Trying %s." % date_yesterday.strftime('%Y-%m-%d'))
            soup = BeautifulSoup( self.fetch_page( self.paper_url(date_yesterday) ), 'html.parser' )
            
            if date_yesterday != self.scrape_print_date(soup):
                raise ScraperError("We can't find the correct page of contents for today.")

        self.issue_date = date_today
        
        if self.issue_date.weekday() == 6:
            self.paper_name = self.contents['meta']['paper_name'] = 'observer'
        else:
            self.paper_name = self.contents['meta']['paper_name'] = 'guardian'
        
        return True
        
    
    def scrape_print_date(self, soup):
        """
        Given a Beautiful Soup object of the page of a Guardian/Observer issue
        contents this will extract the date of the issue from the page and return a
        datetime object.
        """
        # Get the string of the date, eg "Monday 14 December 2015".
        today_str = soup.find('div', {'class': 'fc-container__header__description'}).string

        return dateutil.parser.parse(today_str)
    
    
    def paper_url(self, paper_date):
        """
        Given a datetime object it will return the URL of the Observer (on Sundays)
        or the Guardian (any other day).
        """
        if paper_date.weekday() == 6:
            return self.source_urls['observer']   # Sunday
        else:
            return self.source_urls['guardian']   # Monday to Saturday
        
        
    def fetch_articles(self, page=1):
        """
        Fetches all of the contents of the articles from the API and saves the
        HTMLised version to disk.
        """

        max_articles_to_fetch = 200

        fetched_articles = self.fetch_page_of_articles(page=page,
                                                page_size=max_articles_to_fetch)

        # Will have keys of books, eg 'theguardian/mainsection',
        # and values will be a list of dicts. Each dict an article.
        articles = {}

        if fetched_articles == False:
            raise ScraperError("Error when fetching data from API.")

        for article in fetched_articles:
            tags = article['tags']

            if len(tags) == 0:
                self.message("%s has no tags; unable to put into section." % article['id'])
                continue

            if u'newspaperPageNumber' not in article[u'fields']:
                self.message("%s has no page number; unable to put into section." % article['id'])
                continue

            # Just get the dicts for book and book_section out of the tags list.
            book = next((tag for tag in article['tags'] if tag['type'] == 'newspaper-book'), {})
            book_section = next((tag for tag in article['tags'] if tag['type'] == 'newspaper-book-section'), {})

            # Save some of the book section in the article for use in front end.
            article[u'newspaperBookSection'] = {
                u'id':       book_section['id'],
                u'title':    book_section['webTitle'],
                u'url':      book_section['webUrl'],
            }

            if book['id'] not in self.fetched_books:
                self.fetched_books[ book['id'] ] = {
                    u'meta': book,
                    u'articles': [],
                }

            # Make page number into an int.
            article[u'fields'][u'newspaperPageNumber'] = int(article[u'fields'][u'newspaperPageNumber'])

            # Make wordcount int, and increase issue's max wordcount if appropriate.
            article[u'fields'][u'wordcount'] = int(article[u'fields'][u'wordcount'])
            words = article[u'fields'][u'wordcount']
            if words > self.contents[u'meta'][u'max_words']:
                 self.contents[u'meta'][u'max_words'] = words
            
            # Save file and store its filename:
            article[u'file'] = self.save_article_html(article)

            self.fetched_books[ book['id'] ]['articles'].append(article)

        if len(fetched_articles) >= max_articles_to_fetch:
            # We fetched the maximum, so there might be another page.
            # Call this same method again:
            # Pause, be nice.
            time.sleep(1)
            self.fetch_articles(page=page+1)

    def sort_articles(self):
        """Puts data from self.fetched_books in the correct order and format,
        and puts them into the self.content['books'] list.
        self.fetched_books is like:
            {
                'theguardian/mainsection': {
                    'meta': {...},
                    'articles': [...],
                },
                'theguardian/sport': {
                    ...
                },
                ...
            }

        So, we need to take the value dicts out of there and put them in
        self.content['books'] in the correct order.
        And sort the articles in each section by page number.
        """

        # The initial known books of each day's newspaper, in order:
        start_orders = {
            'weekday': [
                'theguardian/mainsection',
                'theguardian/g2',
            ],
            'saturday': [
                'theguardian/mainsection',
                'theguardian/theguide',
                'theguardian/guardianreview',
                'theguardian/weekend',
                'theguardian/travel',
                'theguardian/cook',
                'theguardian/family',
            ],
            'sunday': [
                'theobserver/news',
                'theobserver/review',
                'theobserver/magazine',
            ]
        }

        # Get today's initial books, and also the sport section.
        if self.paper_name == 'observer':
            start_order = start_orders['sunday']
            sport_id = 'theobserver/sport'

        elif self.issue_date.weekday() == 5:
            start_order = start_orders['saturday']
            sport_id = 'theguardian/sport'

        else:
            start_order = start_orders['weekday']
            sport_id = 'theguardian/sport'
    
        # We'll put the initial books in `start`.
        # And the sport book in `end`.
        # And any others - new books or special one-offs - in `middle`.
        start = []
        middle = []
        end = []

        for book in start_order:
            if book in self.fetched_books:
                start.append(self.fetched_books.pop(book))

        if sport_id in self.fetched_books:
            end.append(self.fetched_books.pop(sport_id))

        for book, bookdata in self.fetched_books.iteritems():
            middle.append(bookdata)

        # Put all the books together in the correct order.
        # self.contents['books'] is now a list of dicts, one dict per book.
        # Each book dict has 'meta' and 'articles' keys.
        self.contents['books'] = start + middle + end

        # Sort the articles within each book:
        for book in self.contents['books']:
            book['articles'] = sorted(book['articles'], key=lambda k: k['fields']['newspaperPageNumber'])


    def fetch_page_of_articles(self, page=1, page_size=200):
        """Fetches a single set of articles from today's issue.
        Returns a list of dicts, each dict an article's data.
        Or False if there was an error.
        """

        api_url = 'http://content.guardianapis.com/search'

        url_args = {
            'page': page,
            'page-size': page_size,
            'api-key': self.guardian_api_key,
            'format': 'json',
            'show-fields': 'body,byline,headline,newspaperPageNumber,publication,shortUrl,standfirst,thumbnail,wordcount',
            'show-elements': 'all',
            'show-tags': 'newspaper-book-section,newspaper-book',
            # Get the articles from today's edition:
            'use-date': 'newspaper-edition',
            'from-date': self.issue_date.strftime("%Y-%m-%d"),
            'to-date': self.issue_date.strftime("%Y-%m-%d"),
            # The most we can fetch per page:
        }

        self.message('Fetching page %s of up to %s articles.' % (page, page_size))

        error_message = ''

        try:
            response = requests.get(api_url, params=url_args, timeout=20)
        except requests.exceptions.ConnectionError as e:
            error_message = "Can't connect to domain."
        except requests.exceptions.ConnectTimeout as e:
            error_message = "Connection timed out."
        except requests.exceptions.ReadTimeout as e:
            error_message = "Read timed out."

        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as e:
            error_message = "HTTP Error: %s" % response.status_code

        if error_message == '':
            # All good so far. Check the returned data.
            data = response.json()
            if 'response' in data and 'status' in data['response'] and 'results' in data['response']:
                if data['response']['status'] != 'ok':
                    error_message = "The API returned the status '%s'" % data['response']['ok']
            else:
                error_message = "The returned data was not the expected format."

        if error_message == '':
            # Still OK!
            articles = data['response']['results']
            self.message("Received %s articles." % len(articles))
            return articles
        else:
            self.message("ERROR: %s" % error_message)
            return False

    def save_article_html(self, article):
        """Makes the HTML for the article and saves it to a file.
        article is all the article's data from the API.
        Returns the filename.
        """
        html = self.make_article_html(article)

        # eg, 'society_2015_dec_11_barbro-loader-obituary.html'
        filename = '%s.%s' % (article['id'].replace('/', '_'), 'html')

        try:
            article_file = open(self.issue_archive_dir + filename, 'w')
            try:
                article_file.write(html.encode('utf-8'))
            finally:
                article_file.close()
        except IOError:
            raise ScraperError(
                    "IOError when writing " + self.issue_archive_dir + filename)

        return filename

    def make_article_html(self, content):
        """
        Takes the content dictionary from the Guardian Item API call and returns a
        simple HTML version of it.
        """

        # TODO: Add colours.
        #if 'sectionId' in content and content['sectionId'] in self.section_ids:
            #html = "<div class=\"section-" + self.section_ids[content['sectionId']] + "\">\n"
        #else:
            #html = "<div class=\"section-default\">\n"
        html = "<div class=\"section-default\">\n"


        html += "<div class=\"meta\">\n"

        if 'publication' in content['fields']:
            html += '<p class="publication">' + content['fields']['publication'] + "</p>\n"

        # Something like 'Guardian. Wednesday 26 May 2010'.
        #html += '<p class="publication">The ' + self.paper_name.title() + '. ' + self.issue_date.strftime("%A %e %B %Y") + "</p>\n"

        if 'sectionName' in content:
            html += '<p class="section">' + content['sectionName'] + "</p>\n"

        html += "</div>\n"

        if 'headline' in content['fields']:
            html += '<div class="headline"><h2>' + content['fields']['headline'] + "</h2></div>\n"

        html += "<div class=\"intro\">\n"

        if 'byline' in content['fields']:
            html += '<p class="byline">' + content['fields']['byline'] + "</p>\n"

        if 'standfirst' in content['fields']:
            html += '<p class="standfirst">' + content['fields']['standfirst'] + "</p>\n"

        html += "</div>\n"

        html += '<div class="body">'

        if 'thumbnail' in content['fields']:
            html += '<img class="thumbnail" alt="Thumbnail" src="' + content['fields']['thumbnail'] + "\" />\n"

        if 'body' in content['fields']:
            if content['fields']['body'] == '<!-- Redistribution rights for this field are unavailable -->':
                # We link this link to the easier-to-read print version.
                html += '<p class="no-rights">Redistribution rights for the article body are unavailable. <a class="see-original" href="' + content['webUrl'] + '/print?mobile-redirect=false">See original.</a></p>'
            else:

                # Get rid of the empty <p> tags that are sometimes in articles, then add to html.
                remove_blanks = re.compile(r'<p></p>')
                html += remove_blanks.sub('', content['fields']['body'])
        else:
            html+= '<p class="no-body">No body text available</p>'

        html +=  "</div>\n"

        html += "<div class=\"footer\">\n"

        if 'webUrl' in content:
            html += '<p class="original"><span>Original: </span><a href="' + content['webUrl'] + '">' + content['webUrl'] + "</a></p>\n"

        if 'shortUrl' in content['fields']:
            html += '<p class="share"><span>Share: </span><input type="text" value="' + content['fields']['shortUrl'] + "\" /></p>\n";

        html += "</div>\n</div>\n"

        html = self.prettify_text( html );
        return html


    def prettify_text(self, text):
        """
        Make text more nicerer. Run it through SmartyPants and Widont.
        """
        text = self.widont(text)
        text = smartypants.smartypants(text)
        return text


    def widont(self, text):
        """From Typogrify http://code.google.com/p/typogrify/
        The only difference is that we also match line endings before a <br />.
        Comments from the original code:

        Replaces the space between the last two words in a string with ``&nbsp;``
        Works in these block tags ``(h1-h6, p, li, dd, dt)`` and also accounts for
        potential closing inline elements ``a, em, strong, span, b, i``

        >>> widont('A very simple test')
        u'A very simple&nbsp;test'

        Single word items shouldn't be changed
        >>> widont('Test')
        u'Test'
        >>> widont(' Test')
        u' Test'
        >>> widont('<ul><li>Test</p></li><ul>')
        u'<ul><li>Test</p></li><ul>'
        >>> widont('<ul><li> Test</p></li><ul>')
        u'<ul><li> Test</p></li><ul>'

        >>> widont('<p>In a couple of paragraphs</p><p>paragraph two</p>')
        u'<p>In a couple of&nbsp;paragraphs</p><p>paragraph&nbsp;two</p>'

        >>> widont('<h1><a href="#">In a link inside a heading</i> </a></h1>')
        u'<h1><a href="#">In a link inside a&nbsp;heading</i> </a></h1>'

        >>> widont('<h1><a href="#">In a link</a> followed by other text</h1>')
        u'<h1><a href="#">In a link</a> followed by other&nbsp;text</h1>'

        Empty HTMLs shouldn't error
        >>> widont('<h1><a href="#"></a></h1>')
        u'<h1><a href="#"></a></h1>'

        >>> widont('<div>Divs get no love!</div>')
        u'<div>Divs get no love!</div>'

        >>> widont('<pre>Neither do PREs</pre>')
        u'<pre>Neither do PREs</pre>'

        >>> widont('<div><p>But divs with paragraphs do!</p></div>')
        u'<div><p>But divs with paragraphs&nbsp;do!</p></div>'
        """
        widont_finder = re.compile(r"""((?:</?(?:a|em|span|strong|i|b)[^>]*>)|[^<>\s]) # must be proceeded by an approved inline opening or closing tag or a nontag/nonspace
                                       \s+                                             # the space to replace
                                       ([^<>\s]+                                       # must be flollowed by non-tag non-space characters
                                       \s*                                             # optional white space!
                                       (</(a|em|span|strong|i|b)>\s*)*                 # optional closing inline tags with optional white space after each
                                       ((</(p|h[1-6]|li|dt|dd)>|<br\s?/?>)|$))                   # end with a closing p, h1-6, li or the end of the string
                                       """, re.VERBOSE)
        output = widont_finder.sub(r'\1&nbsp;\2', text)
        return output

    def fetch_page(self, url):
        "Used for fetching all the remote pages."

        self.message('Fetching: ' + url)

        try:
            response = requests.get(url, timeout=10)
        except requests.exceptions.ConnectionError as e:
            self.message("Can't connect to domain.")
        except requests.exceptions.ConnectTimeout as e:
            self.message("Connection timed out.")
        except requests.exceptions.ReadTimeout as e:
            self.message("Read timed out.")

        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as e:
            self.message("HTTP Error: %s" % response.status_code)

        return response.text

    def count_words(self, text):
        self.LINE_SEPS = ['\n']
        self.WORD_SEPS = ['\s']
        self.REPEATER_SEPS = ['-']
        self.IGNORE = []

        def ors(l): return r"|".join([re.escape(c) for c in l])
        def retext(text, chars, sub):
            return re.compile(ors(chars)).sub(sub, text)

        lines = text and len(re.compile(ors(self.LINE_SEPS)).split(text)) or 0

        text = retext(text, self.WORD_SEPS + self.LINE_SEPS, u" ")
        text = retext(text.strip(), self.IGNORE, u"")
        words = text and len(re.compile(r"[ ]+").split(text)) or 0

        return (words, lines)

    def message(self, text):
        "Output debugging info, if in verbose mode."
        if self.verbose:
            print text


class ScraperError(Exception):
    pass


def main():
    scraper = GuardianGrabber()

    scraper.start()


if __name__ == "__main__":
    main()
