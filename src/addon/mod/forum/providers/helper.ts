// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CoreFileProvider } from '@providers/file';
import { CoreFileUploaderProvider } from '@core/fileuploader/providers/fileuploader';
import { CoreSitesProvider } from '@providers/sites';
import { CoreTimeUtilsProvider } from '@providers/utils/time';
import { CoreUserProvider } from '@core/user/providers/user';
import { AddonModForumProvider } from './forum';
import { AddonModForumOfflineProvider } from './offline';

/**
 * Service that provides some features for forums.
 */
@Injectable()
export class AddonModForumHelperProvider {
    constructor(private translate: TranslateService,
            private fileProvider: CoreFileProvider,
            private sitesProvider: CoreSitesProvider,
            private uploaderProvider: CoreFileUploaderProvider,
            private timeUtils: CoreTimeUtilsProvider,
            private userProvider: CoreUserProvider,
            private forumProvider: AddonModForumProvider,
            private forumOffline: AddonModForumOfflineProvider) {}

    /**
     * Convert offline reply to online format in order to be compatible with them.
     *
     * @param  {any}    offlineReply Offline version of the reply.
     * @param  {string} [siteId]     Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved with the object converted to Online.
     */
    convertOfflineReplyToOnline(offlineReply: any, siteId?: string): Promise<any> {
        const reply: any = {
                attachments: [],
                canreply: false,
                children: [],
                created: offlineReply.timecreated,
                discussion: offlineReply.discussionid,
                id: false,
                mailed: 0,
                mailnow: 0,
                message: offlineReply.message,
                messageformat: 1,
                messagetrust: 0,
                modified: false,
                parent: offlineReply.postid,
                postread: false,
                subject: offlineReply.subject,
                totalscore: 0,
                userid: offlineReply.userid,
                isprivatereply: offlineReply.options && offlineReply.options.private
            },
            promises = [];

        // Treat attachments if any.
        if (offlineReply.options && offlineReply.options.attachmentsid) {
            reply.attachments = offlineReply.options.attachmentsid.online || [];

            if (offlineReply.options.attachmentsid.offline) {
                promises.push(this.getReplyStoredFiles(offlineReply.forumid, reply.parent, siteId, reply.userid)
                            .then((files) => {
                    reply.attachments = reply.attachments.concat(files);
                }));
            }
        }

        // Get user data.
        promises.push(this.userProvider.getProfile(offlineReply.userid, offlineReply.courseid, true).then((user) => {
            reply.userfullname = user.fullname;
            reply.userpictureurl = user.profileimageurl;
        }).catch(() => {
            // Ignore errors.
        }));

        return Promise.all(promises).then(() => {
            reply.attachment = reply.attachments.length > 0 ? 1 : 0;

            return reply;
        });
    }

    /**
     * Delete stored attachment files for a new discussion.
     *
     * @param  {number} forumId     Forum ID.
     * @param  {number} timecreated The time the discussion was created.
     * @param  {string} [siteId]    Site ID. If not defined, current site.
     * @return {Promise<any>}       Promise resolved when deleted.
     */
    deleteNewDiscussionStoredFiles(forumId: number, timecreated: number, siteId?: string): Promise<any> {
        return this.forumOffline.getNewDiscussionFolder(forumId, timecreated, siteId).then((folderPath) => {
            return this.fileProvider.removeDir(folderPath).catch(() => {
                // Ignore any errors, CoreFileProvider.removeDir fails if folder doesn't exists.
            });
        });
    }

    /**
     * Delete stored attachment files for a reply.
     *
     * @param  {number} forumId  Forum ID.
     * @param  {number} postId   ID of the post being replied.
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @param  {number} [userId] User the reply belongs to. If not defined, current user in site.
     * @return {Promise<any>}    Promise resolved when deleted.
     */
    deleteReplyStoredFiles(forumId: number, postId: number, siteId?: string, userId?: number): Promise<any> {
        return this.forumOffline.getReplyFolder(forumId, postId, siteId, userId).then((folderPath) => {
            return this.fileProvider.removeDir(folderPath).catch(() => {
                // Ignore any errors, CoreFileProvider.removeDir fails if folder doesn't exists.
            });
        });
    }

    /**
     * Returns the availability message of the given forum.
     *
     * @param {any} forum Forum instance.
     * @return {string} Message or null if the forum has no cut-off or due date.
     */
    getAvailabilityMessage(forum: any): string {
        if (this.isCutoffDateReached(forum)) {
            return this.translate.instant('addon.mod_forum.cutoffdatereached');
        } else if (this.isDueDateReached(forum)) {
            const dueDate = this.timeUtils.userDate(forum.duedate * 1000);

            return this.translate.instant('addon.mod_forum.thisforumisdue', {$a: dueDate});
        } else if (forum.duedate > 0) {
            const dueDate = this.timeUtils.userDate(forum.duedate * 1000);

            return this.translate.instant('addon.mod_forum.thisforumhasduedate', {$a: dueDate});
        } else {
            return null;
        }
    }

    /**
     * Get a forum discussion by id.
     *
     * This function is inefficient because it needs to fetch all discussion pages in the worst case.
     *
     * @param {number} forumId Forum ID.
     * @param {number} discussionId Discussion ID.
     * @param {string} [siteId] Site ID. If not defined, current site.
     * @return {Promise<any>} Promise resolved with the discussion data.
     */
    getDiscussionById(forumId: number, discussionId: number, siteId?: string): Promise<any> {
        siteId = siteId || this.sitesProvider.getCurrentSiteId();

        const findDiscussion = (page: number): Promise<any> => {
            return this.forumProvider.getDiscussions(forumId, undefined, page, false, siteId).then((response) => {
                if (response.discussions && response.discussions.length > 0) {
                    const discussion = response.discussions.find((discussion) => discussion.id == discussionId);
                    if (discussion) {
                        return discussion;
                    }
                    if (response.canLoadMore) {
                        return findDiscussion(page + 1);
                    }
                }

                return Promise.reject(null);
            });
        };

        return findDiscussion(0);
    }

    /**
     * Get a list of stored attachment files for a new discussion. See AddonModForumHelper#storeNewDiscussionFiles.
     *
     * @param  {number} forumId     Forum ID.
     * @param  {number} timecreated The time the discussion was created.
     * @param  {string} [siteId]    Site ID. If not defined, current site.
     * @return {Promise<any[]>}     Promise resolved with the files.
     */
    getNewDiscussionStoredFiles(forumId: number, timecreated: number, siteId?: string): Promise<any[]> {
        return this.forumOffline.getNewDiscussionFolder(forumId, timecreated, siteId).then((folderPath) => {
            return this.uploaderProvider.getStoredFiles(folderPath);
        });
    }

    /**
     * Get a list of stored attachment files for a reply. See AddonModForumHelper#storeReplyFiles.
     *
     * @param  {number} forumId  Forum ID.
     * @param  {number} postId   ID of the post being replied.
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @param  {number} [userId] User the reply belongs to. If not defined, current user in site.
     * @return {Promise<any[]>}  Promise resolved with the files.
     */
    getReplyStoredFiles(forumId: number, postId: number, siteId?: string, userId?: number): Promise<any[]> {
        return this.forumOffline.getReplyFolder(forumId, postId, siteId, userId).then((folderPath) => {
            return this.uploaderProvider.getStoredFiles(folderPath);
        });
    }

    /**
     * Check if the data of a post/discussion has changed.
     *
     * @param  {any} post       Current data.
     * @param  {any} [original] Original ata.
     * @return {boolean} True if data has changed, false otherwise.
     */
    hasPostDataChanged(post: any, original?: any): boolean {
        if (!original || original.subject == null) {
            // There is no original data, assume it hasn't changed.
            return false;
        }

        if (post.subject != original.subject || post.message != original.message) {
            return true;
        }

        if (post.isprivatereply != original.isprivatereply) {
            return true;
        }

        return this.uploaderProvider.areFileListDifferent(post.files, original.files);
    }

    /**
     * Is the cutoff date for the forum reached?
     *
     * @param {any} forum Forum instance.
     * @return {boolean}
     */
    isCutoffDateReached(forum: any): boolean {
        const now = Date.now() / 1000;

        return forum.cutoffdate > 0 && forum.cutoffdate < now;
    }

    /**
     * Is the due date for the forum reached?
     *
     * @param {any} forum Forum instance.
     * @return {boolean}
     */
    isDueDateReached(forum: any): boolean {
        const now = Date.now() / 1000;

        return forum.duedate > 0 && forum.duedate < now;
    }

    /**
     * Given a list of files (either online files or local files), store the local files in a local folder
     * to be submitted later.
     *
     * @param  {number} forumId     Forum ID.
     * @param  {number} timecreated The time the discussion was created.
     * @param  {any[]}  files       List of files.
     * @param  {string} [siteId]    Site ID. If not defined, current site.
     * @return {Promise<any>}       Promise resolved if success, rejected otherwise.
     */
    storeNewDiscussionFiles(forumId: number, timecreated: number, files: any[], siteId?: string): Promise<any> {
        // Get the folder where to store the files.
        return this.forumOffline.getNewDiscussionFolder(forumId, timecreated, siteId).then((folderPath) => {
            return this.uploaderProvider.storeFilesToUpload(folderPath, files);
        });
    }

    /**
     * Given a list of files (either online files or local files), store the local files in a local folder
     * to be submitted later.
     *
     * @param  {number} forumId  Forum ID.
     * @param  {number} postId   ID of the post being replied.
     * @param  {any[]}  files    List of files.
     * @param  {string} [siteId] Site ID. If not defined, current site.
     * @param  {number} [userId] User the reply belongs to. If not defined, current user in site.
     * @return {Promise<any>}    Promise resolved if success, rejected otherwise.
     */
    storeReplyFiles(forumId: number, postId: number, files: any[], siteId?: string, userId?: number): Promise<any> {
        // Get the folder where to store the files.
        return this.forumOffline.getReplyFolder(forumId, postId, siteId, userId).then((folderPath) => {
            return this.uploaderProvider.storeFilesToUpload(folderPath, files);
        });
    }

    /**
     * Upload or store some files for a new discussion, depending if the user is offline or not.
     *
     * @param  {number}  forumId     Forum ID.
     * @param  {number}  timecreated The time the discussion was created.
     * @param  {any[]}   files       List of files.
     * @param  {boolean} offline     True if files sould be stored for offline, false to upload them.
     * @param  {string}  [siteId]    Site ID. If not defined, current site.
     * @return {Promise<any>}        Promise resolved if success.
     */
    uploadOrStoreNewDiscussionFiles(forumId: number, timecreated: number, files: any[], offline: boolean, siteId?: string)
            : Promise<any> {
        if (offline) {
            return this.storeNewDiscussionFiles(forumId, timecreated, files, siteId);
        } else {
            return this.uploaderProvider.uploadOrReuploadFiles(files, AddonModForumProvider.COMPONENT, forumId, siteId);
        }
    }

    /**
     * Upload or store some files for a reply, depending if the user is offline or not.
     *
     * @param  {number}  forumId  Forum ID.
     * @param  {number}  postId   ID of the post being replied.
     * @param  {any[]}   files    List of files.
     * @param  {boolean} offline  True if files sould be stored for offline, false to upload them.
     * @param  {string}  [siteId] Site ID. If not defined, current site.
     * @param  {number}  [userId] User the reply belongs to. If not defined, current user in site.
     * @return {Promise<any>}     Promise resolved if success.
     */
    uploadOrStoreReplyFiles(forumId: number, postId: number, files: any[], offline: boolean, siteId?: string, userId?: number)
            : Promise<any> {
        if (offline) {
            return this.storeReplyFiles(forumId, postId, files, siteId, userId);
        } else {
            return this.uploaderProvider.uploadOrReuploadFiles(files, AddonModForumProvider.COMPONENT, forumId, siteId);
        }
    }
}
